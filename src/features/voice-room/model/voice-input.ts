import rnnoiseWorkletUrl from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';
import rnnoiseWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import rnnoiseSimdUrl from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';
import {recordDesktopDiagnostic} from '@/shared/api/diagnostics';

export type NoiseSuppression = 'off' | 'standard' | 'enhanced';
export type MediaPreferences = {
 mic: string;
 camera: string;
 speaker: string;
 volume: number;
 echo: boolean;
 noise: NoiseSuppression;
 relay: boolean;
};
export const defaultMedia: MediaPreferences = {
 mic: '',
 camera: '',
 speaker: '',
 volume: 100,
 echo: true,
 noise: 'standard',
 relay: false
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
   relay: stored.relay === true
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

/**
 * Движок окна не отдаёт энергию звука в статистике WebRTC (проверено: в outbound-rtp
 * есть только пакеты и байты, а totalAudioEnergy и audioLevel отсутствуют). Поэтому
 * уровень микрофона измеряем сами: включённый, но молчащий дольше пяти секунд микрофон
 * иначе не виден ни в журнале, ни в интерфейсе.
 */
export function watchMicrophoneSilence(
 track: MediaStreamTrack,
 {threshold = 0.002, quietMs = 5000, stepMs = 500} = {}
) {
 let context: AudioContext | undefined,
  timer = 0;
 try {
  context = new AudioContext();
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.4;
  context.createMediaStreamSource(new MediaStream([track])).connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  let quiet = 0,
   reported = false;
  timer = window.setInterval(() => {
   if (track.readyState !== 'live') {
    stop();
    return;
   }
   // Не считаем тишиной отключённый микрофон или неработающий анализатор.
   if (!track.enabled || context?.state !== 'running') {
    quiet = 0;
    return;
   }
   analyser.getFloatTimeDomainData(samples);
   let sum = 0;
   for (const value of samples) sum += value * value;
   if (Math.sqrt(sum / samples.length) >= threshold) {
    quiet = 0;
    if (reported) {
     reported = false;
     recordDesktopDiagnostic('voice_output', 'mic_silent_recovered');
    }
    return;
   }
   quiet += stepMs;
   if (quiet >= quietMs && !reported) {
    reported = true;
    recordDesktopDiagnostic('voice_output', 'mic_silent');
   }
  }, stepMs);
 } catch {
  return () => {};
 }
 function stop() {
  if (timer) window.clearInterval(timer);
  timer = 0;
  void context?.close().catch(() => {});
 }
 return stop;
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
