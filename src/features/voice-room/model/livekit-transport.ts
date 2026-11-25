import type {VoiceAvailability, VoicePeer, VoicePoll} from '@/shared/types';
import {ApiConnectionError} from '@/shared/api';
import type {Call} from './voice-call';
import {voiceService} from './services/voice-service';

type Options = {
 availability: () => VoiceAvailability;
 onPeers: (peers: VoicePeer[]) => void;
 onStream: (id: string, stream: MediaStream | null) => void;
 onConnection: (id: string, state: string | null) => void;
 onError: (error: unknown) => void;
};

export async function startLiveKitTransport(
 call: Call,
 first: VoicePoll & {liveKit: NonNullable<VoicePoll['liveKit']>},
 {availability, onPeers, onStream, onConnection, onError}: Options
) {
 const {Room, RoomEvent, Track, LocalAudioTrack} = await import('livekit-client');
 if (call.stop) return;
 const room = new Room();
 const streams = new Map<string, MediaStream>();
 let peers = first.peers;
 let joined = false;
 let timer: ReturnType<typeof setTimeout> | undefined;
 let lastPoll = performance.now();

 call.stopTransport = () => {
  clearTimeout(timer);
  room.removeAllListeners();
  void room.disconnect(false).catch(() => {});
 };

 function sync() {
  if (call.stop || !joined) return;
  const participants = room.remoteParticipants;
  onPeers(peers.filter(peer => participants.has(peer.client)));
  for (const id of streams.keys()) {
   if (participants.has(id)) continue;
   streams.delete(id);
   onStream(id, null);
   onConnection(id, null);
  }
  for (const [id, participant] of participants) {
   const track = participant.getTrackPublication(Track.Source.Microphone)?.track?.mediaStreamTrack;
   const previous = streams.get(id);
   if (track && previous?.getAudioTracks()[0] !== track) {
    const stream = new MediaStream([track]);
    streams.set(id, stream);
    onStream(id, stream);
   } else if (!track && previous) {
    streams.delete(id);
    onStream(id, null);
   }
   onConnection(id, room.state === 'connected' ? 'connected' : 'connecting');
  }
 }

 room
  .on(RoomEvent.ParticipantConnected, sync)
  .on(RoomEvent.ParticipantDisconnected, sync)
  .on(RoomEvent.TrackSubscribed, sync)
  .on(RoomEvent.TrackUnsubscribed, sync)
  .on(RoomEvent.Reconnecting, () => {
   for (const id of streams.keys()) onConnection(id, 'connecting');
  })
  .on(RoomEvent.Reconnected, sync)
  .on(RoomEvent.Disconnected, () => {
   if (joined && !call.stop) onError(new Error('Соединение LiveKit потеряно. Присоединитесь к комнате снова.'));
  });

 await room.connect(first.liveKit.url, first.liveKit.token);
 if (call.stop) return;
 const input = call.stream.getAudioTracks()[0];
 const microphone = new LocalAudioTrack(input, undefined, true);
 if (!input.enabled) await microphone.mute();
 if (call.stop) return;
 await room.localParticipant.publishTrack(microphone, {source: Track.Source.Microphone});
 if (call.stop) return;
 call.replaceTransportTrack = async (kind, track) => {
  if (kind !== 'audio' || !track) return;
  if (track !== microphone.mediaStreamTrack) await microphone.replaceTrack(track, {userProvidedTrack: true});
 };
 call.setTransportMuted = muted => {
  void (muted ? microphone.mute() : microphone.unmute()).catch(error => {
   if (!call.stop) onError(error);
  });
 };

 async function pollPresence() {
  if (call.stop) return;
  try {
   const data = await voiceService.poll({room: call.room, client: call.client, after: 0, ...availability()});
   if (call.stop) return;
   lastPoll = performance.now();
   peers = data.peers;
   if (room.state === 'connected') sync();
  } catch (error) {
   if (!call.stop && (!(error instanceof ApiConnectionError) || performance.now() - lastPoll > 14000)) onError(error);
  }
  if (!call.stop) timer = setTimeout(() => void pollPresence(), 5000);
 }

 return () => {
  joined = true;
  sync();
  timer = setTimeout(() => void pollPresence(), 5000);
 };
}
