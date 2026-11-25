import {captureTrack, mediaError} from './voice-capture';
import {watchMicrophoneEnd, setCapturedTrackEnabled, stopCapturedTrack, type MediaPreferences} from './voice-input';
import {
 microphoneSource,
 replaceLocalTrack,
 stopMicrophoneGain,
 type Call,
 type TrackKind,
 type VoiceRuntime
} from './voice-call';
import type {VoiceStore} from './voice-store';

export function createVoiceMedia(store: VoiceStore, runtime: VoiceRuntime) {
 const stateActions = store.getState().actions;
 function watchInput(c: Call, track: MediaStreamTrack) {
  c.stopInputWatch?.();
  c.microphone = track;
  stateActions.setMicrophoneLost(false);
  c.stopInputWatch = watchMicrophoneEnd(track, () => {
   if (runtime.call === c && c.microphone === track) stateActions.setMicrophoneLost(true);
  });
 }
 const setLocal = stateActions.setLocal;
 async function changeMedia(c: Call, action: () => Promise<void>) {
  if (runtime.pending || runtime.changingMedia) return;
  runtime.changingMedia = true;
  stateActions.beginOperation();
  try {
   await action();
  } catch (e) {
   if (!c.stop) stateActions.setError(mediaError(e));
  } finally {
   runtime.changingMedia = false;
   stateActions.finishOperation();
  }
 }
 async function toggleCamera() {
  const c = runtime.call;
  if (!c || c.audioOnly) return;
  await changeMedia(c, async () => {
   const track = c.stream.getVideoTracks().length ? null : await captureTrack('video', store.getState().preferences);
   if (await replaceLocalTrack(c, 'video', track, setLocal)) stateActions.setCamera(!!track);
  });
 }
 function setMicVolume(value: number) {
  value = Math.max(0, Math.min(200, value));
  runtime.preferredMicVolume = value;
  const c = runtime.call;
  if (!c) {
   stateActions.setMicVolume(value);
   return;
  }
  if (c.micGain) {
   c.micGain.gain.gain.value = value / 100;
   stateActions.setMicVolume(value);
   return;
  }
  if (value === 100) return;
  void changeMedia(c, async () => {
   const context = new AudioContext();
   let graph: Call['micGain'];
   try {
    const gain = context.createGain(),
     output = context.createMediaStreamDestination();
    gain.gain.value = value / 100;
    const source = microphoneSource(context, gain, c.microphone);
    gain.connect(output);
    graph = {context, source, gain, track: output.stream.getAudioTracks()[0]};
    c.micGain = graph;
    stateActions.setMicVolume(value);
    await context.resume();
    if (!c.stop) await replaceLocalTrack(c, 'audio', graph.track, setLocal, {keepPrevious: true});
   } catch (error) {
    if (!c.stop) {
     c.micGain = undefined;
     if (graph) stopMicrophoneGain(graph);
     else void context.close();
     stateActions.setMicVolume(100);
    }
    throw error;
   }
  });
 }
 function savePreferences<K extends keyof MediaPreferences>(key: K, value: MediaPreferences[K]) {
  if (store.getState().preferences[key] === value && !(key === 'mic' && store.getState().microphoneLost)) return;
  function save() {
   const next = {...store.getState().preferences, [key]: value};
   stateActions.setPreferences(next);
   localStorage.setItem('mines-media', JSON.stringify(next));
  }
  const c = runtime.call;
  if (key === 'volume') {
   save();
   return;
  }
  if (runtime.pending || runtime.changingMedia) return;
  let kind: TrackKind | undefined;
  if (key === 'mic' || key === 'echo' || key === 'noise') kind = 'audio';
  else if (key === 'camera' && c?.stream.getVideoTracks().length) kind = 'video';
  if (!c || !kind) {
   save();
   return;
  }
  const trackKind = kind;
  void changeMedia(c, async () => {
   const track = await captureTrack(trackKind, {...store.getState().preferences, [key]: value});
   if (trackKind === 'audio' && c.micGain) {
    if (c.stop) {
     stopCapturedTrack(track);
     return;
    }
    const graph = c.micGain;
    try {
     setCapturedTrackEnabled(track, graph.track.enabled);
     const source = microphoneSource(graph.context, graph.gain, track);
     graph.source.disconnect();
     graph.source = source;
    } catch (error) {
     stopCapturedTrack(track);
     throw error;
    }
    stopCapturedTrack(c.microphone);
    watchInput(c, track);
    save();
   } else if (await replaceLocalTrack(c, trackKind, track, setLocal)) {
    if (trackKind === 'audio') watchInput(c, track);
    save();
   }
  });
 }

 return {watchInput, actions: {setMicVolume, savePreferences, toggleCamera}};
}
