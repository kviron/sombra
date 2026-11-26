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
import {desktopPresentation} from './services/desktop-presentation';
import {presentationCaptureQuality} from './presentation-quality';

export type PresentationSource =
 {type: 'window' | 'monitor'} | {type: 'desktop'; sourceId: string} | {type: 'camera'; deviceId: string};

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
  if (runtime.pending || c.changingMedia) return;
  c.changingMedia = true;
  stateActions.beginOperation();
  try {
   await action();
  } catch (e) {
   if (!c.stop) stateActions.setError(mediaError(e));
  } finally {
   c.changingMedia = false;
   if (runtime.call === c && !c.stop) {
    stateActions.finishOperation();
    if (c.presentation?.track.readyState === 'ended') void stopPresentation();
   }
  }
 }
 async function startPresentation(source: PresentationSource) {
  const c = runtime.call;
  if (!c || c.audioOnly || c.presentation) return false;
  let started = false;
  await changeMedia(c, async () => {
   const preferences = store.getState().preferences;
   const quality = presentationCaptureQuality(preferences.presentationQuality);
   const videoQuality = {
    width: {ideal: quality.width, max: quality.width},
    height: {ideal: quality.height, max: quality.height},
    frameRate: {ideal: quality.frameRate, max: quality.frameRate}
   };
   let track: MediaStreamTrack | undefined;
   if (source.type === 'camera') {
    track = await captureTrack('video', {...preferences, camera: source.deviceId}, undefined, videoQuality);
   } else if (source.type === 'desktop') {
    track = await desktopPresentation.capture(source.sourceId, quality, () => runtime.call === c && !c.stop);
   } else {
    if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('Захват экрана недоступен в этой сборке Sombra.');
    try {
     const stream = await navigator.mediaDevices.getDisplayMedia({
      video: {displaySurface: source.type, ...videoQuality},
      audio: false
     });
     [track] = stream.getVideoTracks();
     const surface = track?.getSettings().displaySurface;
     if (!track || (surface && surface !== source.type)) {
      stream.getTracks().forEach(stopCapturedTrack);
      throw new Error(source.type === 'window' ? 'Выберите окно приложения.' : 'Выберите целый экран.');
     }
    } catch (error) {
     if (error instanceof DOMException && error.name === 'NotAllowedError') return;
     throw error;
    }
   }
   track.contentHint = preferences.presentationQuality.profile === 'motion' ? 'motion' : 'detail';
   const restoreCamera = store.getState().camera;
   if (!(await replaceLocalTrack(c, 'video', track, setLocal))) return;
   c.presentation = {track, restoreCamera};
   track.addEventListener(
    'ended',
    () => {
     if (runtime.call === c && c.presentation?.track === track) void stopPresentation();
    },
    {once: true}
   );
   stateActions.setCamera(false);
   stateActions.setPresenting(true);
   started = true;
  });
  return started;
 }
 async function stopPresentation() {
  const c = runtime.call;
  const presentation = c?.presentation;
  if (!c || !presentation) return;
  await changeMedia(c, async () => {
   // Stop sharing immediately, even when the camera needs time to reopen.
   stopCapturedTrack(presentation.track);
   c.presentation = undefined;
   stateActions.setPresenting(false);
   if (!(await replaceLocalTrack(c, 'video', null, setLocal)) || !presentation.restoreCamera) return;
   const camera = await captureTrack('video', store.getState().preferences);
   if (await replaceLocalTrack(c, 'video', camera, setLocal)) stateActions.setCamera(true);
  });
 }
 async function toggleCamera() {
  const c = runtime.call;
  if (!c || c.audioOnly || c.presentation) return;
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
  void changeMedia(c, () => applyMicVolume(c, value));
 }
 async function applyMicVolume(c: Call, value: number) {
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
  if (runtime.pending || c?.changingMedia) return;
  let kind: TrackKind | undefined;
  if (key === 'mic' || key === 'echo' || key === 'noise') kind = 'audio';
  else if (key === 'camera' && !c?.presentation && c?.stream.getVideoTracks().length) kind = 'video';
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

 return {
  watchInput,
  applyMicVolume,
  actions: {setMicVolume, savePreferences, toggleCamera, startPresentation, stopPresentation}
 };
}
