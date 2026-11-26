import {ApiConnectionError} from '@/shared/api';
import type {VoiceAvailability, VoicePeer as Peer, VoicePoll, VoiceSignalPayload} from '@/shared/types';
import {voiceService} from './services/voice-service';
import {createVoicePresence} from './voice-presence';
import {createVoiceSampling} from './voice-transport-sampling';
import {createPeerLink} from './peer-signaling';
import {otherMembers} from './voice-peers';
import {playVoiceCue} from './voice-cues';
import type {Call} from './voice-call';
import type {MediaPreferences} from './voice-input';

type Options = {
 availability: () => VoiceAvailability;
 availabilityRevision: () => number;
 preferences: () => MediaPreferences;
 onPeers: (peers: Peer[]) => void;
 onStream: (id: string, stream: MediaStream | null) => void;
 onConnection: (id: string, state: string | null) => void;
 onError: (error: unknown) => void;
 onSignalError: (error: unknown) => void;
 onPresenceDelay: (delayed: boolean) => void;
};
export function startVoiceTransport(
 c: Call,
 first: VoicePoll,
 {
  availability,
  availabilityRevision,
  preferences,
  onPeers,
  onStream,
  onConnection,
  onError,
  onSignalError,
  onPresenceDelay
 }: Options
) {
 let cursor = 0;
 const presence = createVoicePresence(c, availability, onPresenceDelay);
 const signal = (target: string, payload: VoiceSignalPayload) =>
  voiceService.signal({room: c.room, client: c.client, target, payload});
 const sampling = createVoiceSampling(c, availability, availabilityRevision);
 const links = new Map<string, ReturnType<typeof createPeerLink>>();
 const renewAt = (ttl?: number) => (ttl && ttl > 0 ? Date.now() + ttl * 1000 * 0.8 : Infinity);
 let renewIceAt = renewAt(first.iceTtlSeconds);
 const options = {
  stream: c.stream,
  iceServers: first.iceServers,
  preferRelay: () => preferences().relay,
  signal,
  onStream,
  onConnection,
  onSignalError,
  retryableSignalError: (error: unknown) => error instanceof ApiConnectionError,
  watch: sampling.watch,
  forget: sampling.forget
 };
 let timer: ReturnType<typeof setTimeout>;
 function clearLinks() {
  for (const link of links.values()) link.close();
  links.clear();
  sampling.clear();
 }
 c.stopTransport = () => {
  presence.stop();
  clearTimeout(timer);
  clearLinks();
 };
 c.replaceTransportTrack = async (kind, track) => {
  // Let every sender settle before voice-call rolls the stream back.
  const results = await Promise.allSettled([...links.values()].map(link => link.replaceTrack(kind, track)));
  const failure = results.find(result => result.status === 'rejected');
  if (failure) throw failure.reason;
 };

 function updatePresence(peers: Peer[]) {
  onPeers(peers);
  const previous = c.members;
  const current = otherMembers(peers, c.client);
  c.members = current;
  if (!previous || availability().deaf) return;
  if ([...previous].some(user => !current.has(user))) void playVoiceCue('left', preferences().speaker);
  else if ([...current].some(user => !previous.has(user))) void playVoiceCue('joined', preferences().speaker);
 }

 async function poll() {
  if (c.stop) return;
  try {
   const refreshIce = Date.now() >= renewIceAt;
   const result = await presence.poll(cursor, refreshIce);
   if (!result || c.stop) return;
   const {data, readmitted} = result;
   if (readmitted) clearLinks();
   if (refreshIce || readmitted) {
    options.iceServers = data.iceServers;
    renewIceAt = renewAt(data.iceTtlSeconds);
   }
   const lastPoll = performance.now();
   updatePresence(data.peers);
   const nextClients = new Set(data.peers.map(peer => peer.client));
   for (const [id, link] of links) {
    if (nextClients.has(id)) continue;
    link.close();
    links.delete(id);
   }
   for (const id of nextClients) {
    if (c.stop) return;
    if (id === c.client) continue;
    let link = links.get(id);
    if (!link) {
     link = createPeerLink(c.client, id, options);
     links.set(id, link);
    }
    await link.offer();
   }
   for (const {from, payload} of data.signals) {
    if (c.stop) return;
    await links.get(from)?.receive(payload);
   }
   sampling.sample(data.peers, lastPoll);
   cursor = data.cursor;
  } catch (error) {
   if (!c.stop) onError(error);
  } finally {
   // An empty room only polls for arrivals.
   if (!c.stop) timer = setTimeout(poll, presence.interval(links.size ? 700 : 1000));
  }
 }
 void poll();
}
