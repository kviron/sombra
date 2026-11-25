import type {VoiceSignalPayload} from '@/shared/types';
import type {TrackKind} from './voice-call';

const MAX_RETRIES = 3;
const ANSWER_TIMEOUT_MS = 15_000;
const ICE_VERSION = 2;
const BATCH_SIZE = 16;

// One sender per SDP exchange. Its queue cannot leak into the next ICE generation.
function candidateSender(
 signal: (payload: VoiceSignalPayload) => Promise<unknown>,
 supportsBatch: () => boolean,
 onError: (error: unknown) => void
) {
 const queue: RTCIceCandidateInit[] = [];
 let announced = false,
  sending = false,
  closed = false;
 let timer: ReturnType<typeof setTimeout> | undefined;
 async function flush() {
  timer = undefined;
  if (sending || !announced || closed) return;
  sending = true;
  while (queue.length && !closed) {
   const payload = supportsBatch() ? {candidates: queue.splice(0, BATCH_SIZE)} : {candidate: queue.shift()!};
   try {
    await signal(payload);
   } catch (error) {
    if (!closed) onError(error);
   }
  }
  sending = false;
 }
 return {
  push(candidate: RTCIceCandidateInit) {
   queue.push(candidate);
   if (announced && !sending && !timer) timer = setTimeout(flush, supportsBatch() ? 30 : 0);
  },
  announce() {
   announced = true;
   void flush();
  },
  close() {
   closed = true;
   clearTimeout(timer);
   queue.length = 0;
  }
 };
}

export function peerConfiguration(iceServers: RTCIceServer[] | undefined, relay: boolean): RTCConfiguration {
 const hasTurn =
  Array.isArray(iceServers) &&
  iceServers.some(server => [server?.urls].flat().some(url => typeof url === 'string' && /^turns?:/i.test(url)));
 return {iceServers, iceTransportPolicy: relay && hasTurn ? 'relay' : 'all'};
}

type Options = {
 stream: MediaStream;
 iceServers: RTCIceServer[];
 preferRelay: () => boolean;
 signal: (id: string, payload: VoiceSignalPayload) => Promise<unknown>;
 onConnection: (id: string, state: RTCPeerConnectionState | null) => void;
 onStream: (id: string, stream: MediaStream | null) => void;
 onSignalError: (error: unknown) => void;
 watch: (id: string, pc: RTCPeerConnection, stream: MediaStream) => void;
 forget: (id: string) => void;
};

// One link lives from the participant's arrival until departure, across connection replacements.
export function createPeerLink(client: string, id: string, options: Options) {
 const offerer = client < id;
 let pc: RTCPeerConnection | undefined;
 let connectionId: string | undefined;
 let closed = false;
 let retries = 0;
 let timer: ReturnType<typeof setTimeout> | undefined;
 let answerTimer: ReturnType<typeof setTimeout> | undefined;
 let incoming: {candidate: RTCIceCandidateInit; connectionId?: string}[] = [];
 let outgoing: ReturnType<typeof candidateSender> | undefined;
 let remoteIceVersion = 1;
 let iceRestart: 'idle' | 'requested' | 'in-progress' = 'idle';
 const configuration = () => peerConfiguration(options.iceServers, options.preferRelay());

 function beginExchange(generation?: string) {
  outgoing?.close();
  connectionId = generation;
  outgoing = candidateSender(
   payload => options.signal(id, {...payload, connectionId: generation}),
   () => remoteIceVersion >= ICE_VERSION,
   options.onSignalError
  );
 }

 function retire() {
  clearTimeout(timer);
  clearTimeout(answerTimer);
  const previous = pc;
  pc = undefined;
  connectionId = undefined;
  incoming = [];
  outgoing?.close();
  outgoing = undefined;
  iceRestart = 'idle';
  if (!previous) return;
  previous.close();
  options.forget(id);
  options.onStream(id, null);
  options.onConnection(id, null);
 }

 function send(connection: RTCPeerConnection, payload: VoiceSignalPayload) {
  void options.signal(id, payload).catch(error => {
   if (pc === connection) options.onSignalError(error);
  });
 }

 function recover(allowRestart = true) {
  if (closed || iceRestart === 'requested' || retries >= MAX_RETRIES) return;
  retries++;
  if (!offerer && pc && connectionId) {
   send(pc, {restart: connectionId, ...(iceRestart === 'in-progress' && {replace: true})});
   clearTimeout(timer);
   timer = setTimeout(recover, 4000);
  } else if (
   allowRestart &&
   offerer &&
   pc?.remoteDescription &&
   pc.signalingState === 'stable' &&
   remoteIceVersion >= ICE_VERSION &&
   iceRestart === 'idle'
  ) {
   iceRestart = 'requested';
  } else retire();
 }

 function failed(connection: RTCPeerConnection | undefined, error: unknown) {
  if (closed || pc !== connection) return;
  options.onConnection(id, 'failed');
  options.onSignalError(error);
  if (connection) recover(false);
  else retries++; // Construction failed. The next presence poll can retry this peer.
 }

 function open(generation?: string) {
  const connection = new RTCPeerConnection(configuration());
  pc = connection;
  beginExchange(generation);
  const remote = new MediaStream();
  connection.ontrack = ({track}) => {
   if (pc !== connection) return;
   for (const previous of remote.getTracks()) {
    if (previous.kind === track.kind && previous !== track) remote.removeTrack(previous);
   }
   remote.addTrack(track);
   options.onStream(id, remote);
  };
  connection.onicecandidate = ({candidate}) => {
   if (!candidate || pc !== connection) return;
   outgoing?.push(candidate.toJSON());
  };
  connection.onconnectionstatechange = () => {
   if (pc !== connection) return;
   const state = connection.connectionState;
   options.onConnection(id, state);
   clearTimeout(timer);
   if (state === 'connected') {
    retries = 0;
    if (connection.signalingState === 'stable' && iceRestart === 'in-progress') iceRestart = 'idle';
   }
   if (state === 'failed' || state === 'disconnected') timer = setTimeout(recover, state === 'failed' ? 1500 : 8000);
  };
  options.watch(id, connection, remote);
  return connection;
 }

 async function sendDescription(connection: RTCPeerConnection, restartOf?: string) {
  const sender = outgoing;
  await connection.setLocalDescription();
  if (pc !== connection || !connection.localDescription) return;
  await options.signal(id, {
   description: connection.localDescription,
   connectionId,
   iceVersion: ICE_VERSION,
   ...(restartOf && {restartOf})
  });
  if (pc === connection && outgoing === sender) sender?.announce();
 }

 async function addCandidate(connection: RTCPeerConnection, candidate: RTCIceCandidateInit) {
  try {
   await connection.addIceCandidate(candidate);
  } catch (error) {
   // Older clients send untagged candidates. A stale ICE generation rejects just that candidate.
   if (pc === connection && !(error instanceof DOMException && error.name === 'OperationError')) throw error;
  }
 }

 async function offer() {
  if (closed || !offerer || (pc && iceRestart !== 'requested') || retries > MAX_RETRIES) return;
  let connection = pc;
  try {
   let restartOf: string | undefined;
   if (connection) {
    iceRestart = 'in-progress';
    restartOf = connectionId;
    beginExchange(crypto.randomUUID());
    connection.setConfiguration(configuration());
    connection.restartIce();
   } else {
    connection = open(crypto.randomUUID());
    connection.addTransceiver(options.stream.getAudioTracks()[0], {direction: 'sendrecv'});
    connection.addTransceiver(options.stream.getVideoTracks()[0] ?? 'video', {direction: 'sendrecv'});
   }
   await sendDescription(connection, restartOf);
   if (connection.signalingState !== 'have-local-offer') return;
   // Without an answer ICE may stay "new" forever and never fire the recovery handler.
   answerTimer = setTimeout(() => {
    if (retries < MAX_RETRIES) return recover(false);
    retries++;
    retire();
    options.onConnection(id, 'failed');
    options.onSignalError(new Error('Участник не ответил на запрос соединения.'));
   }, ANSWER_TIMEOUT_MS);
  } catch (error) {
   failed(connection, error);
  }
 }

 async function applyDescription(connection: RTCPeerConnection, description: RTCSessionDescriptionInit) {
  await connection.setRemoteDescription(description);
  if (pc !== connection) return;
  if (description.type === 'answer') clearTimeout(answerTimer);
  const queued = incoming;
  incoming = [];
  for (const item of queued) {
   if (pc !== connection) return;
   if (item.connectionId === connectionId || (!item.connectionId && remoteIceVersion < ICE_VERSION))
    await addCandidate(connection, item.candidate);
  }
  if (description.type !== 'offer') return;
  for (const transceiver of connection.getTransceivers()) {
   if (pc !== connection) return;
   transceiver.direction = 'sendrecv';
   const kind = transceiver.receiver.track.kind;
   await transceiver.sender.replaceTrack(options.stream.getTracks().find(track => track.kind === kind) ?? null);
  }
  if (pc === connection) await sendDescription(connection);
 }

 async function receive({
  description,
  candidate,
  candidates,
  restart,
  replace,
  restartOf,
  iceVersion,
  connectionId: generation
 }: VoiceSignalPayload) {
  if (closed) return;
  let connection = pc;
  try {
   if (restart) {
    if (offerer && connectionId === restart) recover(!replace);
    return;
   }
   if (description) {
    if (description.type === 'offer') {
     if (offerer) return;
     if (restartOf) {
      if (
       !connection ||
       restartOf !== connectionId ||
       !generation ||
       generation === connectionId ||
       connection.signalingState !== 'stable'
      )
       return;
      clearTimeout(timer);
      iceRestart = 'in-progress';
      beginExchange(generation);
      connection.setConfiguration(configuration());
     } else if (generation && generation !== connectionId && connection) {
      retire();
      connection = undefined;
     }
     connection ??= open(generation);
     if (!restartOf && connection.remoteDescription) beginExchange(generation);
    } else if (
     description.type !== 'answer' ||
     connection?.signalingState !== 'have-local-offer' ||
     (generation !== connectionId && (generation || iceRestart === 'in-progress'))
    )
     return;
    remoteIceVersion = iceVersion ?? 1;
    await applyDescription(connection, description);
    if (pc === connection && iceRestart === 'in-progress') {
     clearTimeout(timer);
     if (connection.connectionState === 'connected') iceRestart = 'idle';
     else timer = setTimeout(() => recover(false), 8000);
    }
   }
   if (pc !== connection || closed) return;
   if (connection && generation !== connectionId && (generation || remoteIceVersion >= ICE_VERSION)) return;
   const batch = Array.isArray(candidates) ? candidates.slice(0, BATCH_SIZE) : [];
   for (const item of candidate ? [candidate] : batch) {
    if (closed || pc !== connection) return;
    if (connection?.remoteDescription && connection.signalingState !== 'have-local-offer')
     await addCandidate(connection, item);
    else if (incoming.length < 256) incoming.push({candidate: item, connectionId: generation});
   }
  } catch (error) {
   failed(connection, error);
  }
 }

 async function replaceTrack(kind: TrackKind, track: MediaStreamTrack | null) {
  const connection = pc;
  const sender = connection?.getTransceivers().find(t => t.receiver.track.kind === kind)?.sender;
  try {
   await sender?.replaceTrack(track);
  } catch (error) {
   if (pc === connection) throw error;
  }
 }

 return {
  offer,
  receive,
  replaceTrack,
  close() {
   closed = true;
   retire();
  }
 };
}
