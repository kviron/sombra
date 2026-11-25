import {recordDesktopDiagnostic} from '@/shared/api/diagnostics';
import {refreshCapturedDevice} from '@/shared/lib/media-devices';
import {captureVoiceStream, stopCapturedTrack, type MediaPreferences} from './voice-input';
import type {TrackKind} from './voice-call';
export function mediaError(e: unknown) {
 const name = (e as DOMException).name;
 return name === 'NotAllowedError'
  ? 'Разрешите доступ к микрофону или камере в настройках приложения и Windows.'
  : name === 'NotFoundError'
    ? 'Устройство не найдено. Подключите микрофон или камеру.'
    : name === 'NotReadableError'
      ? 'Устройство занято другим приложением. Освободите его и повторите.'
      : (e as Error).message || 'Не удалось подключить устройство.';
}
function videoConstraints(p: MediaPreferences) {
 return {deviceId: p.camera ? {exact: p.camera} : undefined, width: {ideal: 1280}, height: {ideal: 720}};
}
export async function captureTrack(kind: TrackKind, preferences: MediaPreferences, shouldReport = () => true) {
 try {
  const stream =
   kind === 'audio'
    ? await captureVoiceStream(preferences)
    : await navigator.mediaDevices.getUserMedia({video: videoConstraints(preferences)});
  const track = stream.getTracks().find(t => t.kind === kind);
  if (track) {
   refreshCapturedDevice(track);
   return track;
  }
  stream.getTracks().forEach(stopCapturedTrack);
  throw new DOMException('Устройство не найдено', 'NotFoundError');
 } catch (error) {
  if (shouldReport())
   recordDesktopDiagnostic(
    kind === 'audio' ? 'voice_microphone' : 'voice_camera',
    (error as DOMException).name === 'NotAllowedError' ? 'device_permission' : 'device_error'
   );
  throw error;
 }
}

// Dispose of tracks returned after the permission timeout or call cancellation.
export function captureTrackForJoin(kind: TrackKind, preferences: MediaPreferences, isCurrent: () => boolean) {
 return new Promise<MediaStreamTrack>((resolve, reject) => {
  let settled = false;
  const timer = setTimeout(() => {
   settled = true;
   if (kind === 'audio' && isCurrent()) recordDesktopDiagnostic('voice_output', 'input_device_failed');
   reject(new Error('Истекло время ожидания доступа к устройству. Повторите подключение.'));
  }, 30000);
  void captureTrack(kind, preferences, () => !settled && isCurrent()).then(
   track => {
    clearTimeout(timer);
    if (settled || !isCurrent()) {
     stopCapturedTrack(track);
     if (!settled) reject(new Error('Подключение отменено.'));
     return;
    }
    settled = true;
    resolve(track);
   },
   error => {
    clearTimeout(timer);
    if (!settled) {
     settled = true;
     reject(error);
    }
   }
  );
 });
}
