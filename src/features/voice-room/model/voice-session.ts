import type {VoiceAvailability} from '@/shared/types';
import {recordDesktopDiagnostic} from '@/shared/api/diagnostics';
import {voiceService} from './services/voice-service';
import {captureTrackForJoin, mediaError} from './voice-capture';
import {setCapturedTrackEnabled, stopCapturedTrack, type MediaPreferences} from './voice-input';
import {monitorOutgoingMicrophone, stopCall, type Call, type VoiceRuntime} from './voice-call';
import {otherMembers} from './voice-peers';
import {playVoiceCue} from './voice-cues';
import {startVoiceTransport} from './voice-transport';
import {startLiveKitTransport} from './livekit-transport';
import {createVoiceMedia} from './voice-media';
import {selectVoiceAvailability} from './voice-selectors';
import {createVoiceStore} from './voice-store';

export function createVoiceSession(preferences: MediaPreferences) {
 const store = createVoiceStore(preferences);
 const runtime: VoiceRuntime = {
  call: null,
  pending: null,
  generation: 0,
  availabilityRevision: 0,
  preferredMicVolume: 100
 };
 const stateActions = store.getState().actions;
 const media = createVoiceMedia(store, runtime);
 const availability = () => selectVoiceAvailability(store.getState());
 const preferred = () => store.getState().preferences;

 function leave() {
  runtime.generation++;
  runtime.pending = null;
  const c = runtime.call;
  runtime.call = null;
  if (c) {
   stopCall(c);
   void voiceService.leave({room: c.room, client: c.client}).catch(() => {});
   if (c.members) void playVoiceCue('left', preferred().speaker);
  }
  stateActions.resetCall(runtime.preferredMicVolume);
 }
 async function join(destination: string, withVideo = false) {
  if (runtime.pending || runtime.call?.changingMedia) return false;
  leave();
  const operation = Symbol('voice-join');
  runtime.pending = operation;
  const epoch = runtime.generation;
  stateActions.beginOperation();
  let acquired: MediaStream | null = null;
  try {
   if (!navigator.mediaDevices) {
    recordDesktopDiagnostic('voice_output', 'input_device_failed');
    throw new Error('Для доступа к устройствам откройте приложение через HTTPS или localhost.');
   }
   const capture = (kind: 'audio' | 'video') =>
    captureTrackForJoin(kind, preferred(), () => epoch === runtime.generation);
   acquired = new MediaStream([await capture('audio')]);
   if (withVideo) acquired.addTrack(await capture('video'));
   if (epoch !== runtime.generation) {
    acquired.getTracks().forEach(stopCapturedTrack);
    return false;
   }
   const c: Call = {
    room: destination,
    client: crypto.randomUUID(),
    stream: acquired,
    stop: false,
    microphone: acquired.getAudioTracks()[0]
   };
   runtime.call = c;
   setCapturedTrackEnabled(c.microphone, !availability().muted && !availability().deaf);
   media.watchInput(c, c.microphone);
   const first = await voiceService.join({room: c.room, client: c.client, ...availability()});
   if (c.stop) {
    // Server admission may finish after cancellation; retire only the abandoned client.
    void voiceService.leave({room: c.room, client: c.client}).catch(() => {});
    return false;
   }
   if (runtime.preferredMicVolume !== 100) {
    await media.applyMicVolume(c, runtime.preferredMicVolume);
    if (c.stop) return false;
   } else monitorOutgoingMicrophone(c, c.microphone);
   c.members = otherMembers(first.peers, c.client);
   const callbacks = {
    availability,
    availabilityRevision: () => runtime.availabilityRevision,
    preferences: preferred,
    onPresenceDelay: stateActions.setPresenceDelayed,
    onPeers: (incoming: typeof first.peers) => stateActions.setPeers(incoming, c.client),
    onStream: stateActions.setRemoteStream,
    onConnection: stateActions.setConnection,
    onSignalError: (error: unknown) => {
     if (runtime.call === c) stateActions.setError(mediaError(error));
    },
    onError: (error: unknown) => {
     if (runtime.call !== c) return;
     leave();
     stateActions.setError(mediaError(error));
    }
   };
   if (first.liveKit) {
    c.audioOnly = true;
    for (const track of acquired.getVideoTracks()) {
     acquired.removeTrack(track);
     stopCapturedTrack(track);
    }
    const start = await startLiveKitTransport(c, {...first, liveKit: first.liveKit}, callbacks);
    if (c.stop || !start) return false;
    stateActions.connected(destination, acquired, false, first.peers, c.client, true);
    start();
   } else {
    stateActions.connected(destination, acquired, withVideo, first.peers, c.client);
    startVoiceTransport(c, first, callbacks);
   }
   return true;
  } catch (error) {
   acquired?.getTracks().forEach(stopCapturedTrack);
   if (epoch === runtime.generation) {
    leave();
    stateActions.setError(mediaError(error));
   }
   return false;
  } finally {
   if (runtime.pending === operation) {
    runtime.pending = null;
    stateActions.finishOperation();
    if (runtime.call && store.getState().room && !runtime.call.micGain && runtime.preferredMicVolume !== 100)
     media.actions.setMicVolume(runtime.preferredMicVolume);
   }
  }
 }
 function applyAvailability(next: VoiceAvailability) {
  runtime.availabilityRevision++;
  const c = runtime.call;
  if (!c) return;
  const enabled = !next.muted && !next.deaf;
  setCapturedTrackEnabled(c.microphone, enabled);
  c.stream.getAudioTracks().forEach(track => {
   track.enabled = enabled;
  });
  c.setTransportMuted?.(!enabled);
 }
 function toggleMic() {
  if (store.getState().microphoneLost) {
   media.actions.savePreferences('mic', preferred().mic);
   return;
  }
  const {muted, deaf} = availability();
  const next = stateActions.toggleMic();
  if (runtime.call && !runtime.call.stop) {
   if (muted !== next.muted) recordDesktopDiagnostic('voice_output', next.muted ? 'mic_muted' : 'mic_unmuted');
   if (deaf) recordDesktopDiagnostic('voice_output', 'output_undeafened');
  }
  applyAvailability(next);
 }
 function toggleDeaf() {
  const previous = availability();
  const next = stateActions.toggleDeaf();
  if (runtime.call && !runtime.call.stop)
   recordDesktopDiagnostic('voice_output', previous.deaf ? 'output_undeafened' : 'output_deafened');
  applyAvailability(next);
 }
 return {store, actions: {join, leave, toggleMic, toggleDeaf, ...media.actions}};
}
