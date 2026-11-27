import rnnoiseWorkletUrl from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';
import rnnoiseWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import rnnoiseSimdUrl from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';
import {recordDesktopDiagnostic} from '@/shared/api/diagnostics';
import {defaultPresentationQuality, readPresentationQuality, type PresentationQuality} from './presentation-quality';

export type NoiseSuppression = 'off' | 'standard' | 'enhanced';
export type MediaPreferences = {
 mic: string;
 camera: string;
 speaker: string;
 volume: number;
 echo: boolean;
 noise: NoiseSuppression;
 relay: boolean;
 presentationQuality: PresentationQuality;
};
export const defaultMedia: MediaPreferences = {
 mic: '',
 camera: '',
 speaker: '',
 volume: 100,
 echo: true,
 noise: 'standard',
 relay: false,
 presentationQuality: defaultPresentationQuality
};

export function readMedia(): MediaPreferences {
 try {
  const stored = JSON.parse(localStorage.getItem('mines-media') || '{}') as Partial<Omit<MediaPreferences, 'noise'>> & {
   noise?: unknown;
  };
  const noise = stored.noise;
  return {
   ...defaultMedia,
   ...stored,
   noise: noise === false || noise === 'off' ? 'off' : noise === 'enhanced' ? 'enhanced' : 'standard',
   relay: stored.relay === true,
   presentationQuality: readPresentationQuality(stored.presentationQuality)
  };
 } catch {
  return defaultMedia;
 }
}

function audioConstraints(preferences: MediaPreferences): MediaTrackConstraints {
 return {
  deviceId: preferences.mic ? {exact: preferences.mic} : undefined,
  // WebView2 can crash when LiveKit reads back advanced echo-cancellation constraints.
  echoCancellation: preferences.echo,
  noiseSuppression: preferences.noise === 'standard',
  // Automatic gain can amplify the noise left by the browser's audio processing.
  autoGainControl: preferences.noise === 'off'
 };
}

const processedTracks = new WeakMap<MediaStreamTrack, {input: MediaStreamTrack; dispose: () => void}>();
let wasmBinary: Promise<ArrayBuffer> | undefined;

// Observe the physical input even when the outgoing track is produced by RNNoise.
export function watchMicrophoneEnd(track: MediaStreamTrack, onEnd: () => void) {
 const input = processedTracks.get(track)?.input ?? track;
 input.addEventListener('ended', onEnd, {once: true});
 if (input.readyState === 'ended') onEnd();
 return () => input.removeEventListener('ended', onEnd);
}

export function setCapturedTrackEnabled(track: MediaStreamTrack, enabled: boolean) {
 track.enabled = enabled;
 const processing = processedTracks.get(track);
 if (processing) processing.input.enabled = enabled;
}

export function stopCapturedTrack(track: MediaStreamTrack) {
 processedTracks.get(track)?.dispose();
 if (track.readyState !== 'ended') track.stop();
}

/** A track ends on its own when the device is unplugged, permission is revoked or the
 *  system mute switch cuts the source. Calling stop() ourselves does not fire it. */
function watchCaptureEnd(track: MediaStreamTrack) {
 track.addEventListener('ended', () => recordDesktopDiagnostic('voice_microphone', 'device_error'), {once: true});
}

export async function captureVoiceStream(preferences: MediaPreferences, video: MediaTrackConstraints | false = false) {
 const stream = await navigator.mediaDevices.getUserMedia({audio: audioConstraints(preferences), video});
 const input = stream.getAudioTracks()[0];
 if (input && preferences.noise !== 'enhanced') {
  watchCaptureEnd(input);
  return stream;
 }
 if (!input) {
  stream.getTracks().forEach(stopCapturedTrack);
  throw new DOMException('Устройство не найдено', 'NotFoundError');
 }

 let context: AudioContext | undefined;
 try {
  const {RnnoiseWorkletNode, loadRnnoise} = await import('@sapphi-red/web-noise-suppressor');
  const audio = new AudioContext({sampleRate: 48000});
  context = audio;
  wasmBinary ??= loadRnnoise({url: rnnoiseWasmUrl, simdUrl: rnnoiseSimdUrl}, {signal: AbortSignal.timeout(8000)}).catch(
   error => {
    wasmBinary = undefined;
    throw error;
   }
  );
  const [binary] = await Promise.all([wasmBinary, audio.audioWorklet.addModule(rnnoiseWorkletUrl), audio.resume()]);
  const source = audio.createMediaStreamSource(stream);
  const filter = new RnnoiseWorkletNode(audio, {wasmBinary: binary, maxChannels: 1});
  filter.channelCount = 1;
  filter.channelCountMode = 'explicit';
  const output = audio.createMediaStreamDestination();
  output.channelCount = 1;
  const track = output.stream.getAudioTracks()[0];
  source.connect(filter).connect(output);
  track.contentHint = 'speech';
  function dispose() {
   processedTracks.delete(track);
   input.removeEventListener('ended', onInputEnded);
   source.disconnect();
   filter.disconnect();
   filter.destroy();
   stopCapturedTrack(input);
   void audio.close();
  }
  function onInputEnded() {
   recordDesktopDiagnostic('voice_microphone', 'device_error');
   stopCapturedTrack(track);
  }
  processedTracks.set(track, {input, dispose});
  input.addEventListener('ended', onInputEnded, {once: true});
  filter.addEventListener(
   'processorerror',
   () => {
    if (!processedTracks.has(track)) return;
    source.disconnect();
    source.connect(output);
    void input.applyConstraints(audioConstraints({...preferences, noise: 'standard'})).catch(() => {});
    recordDesktopDiagnostic('voice_microphone', 'device_error');
   },
   {once: true}
  );
  return new MediaStream([track, ...stream.getVideoTracks()]);
 } catch {
  stream.getTracks().forEach(stopCapturedTrack);
  if (context) void context.close();
  throw new Error('Усиленное шумоподавление недоступно. Выберите «Стандартное».');
 }
}
