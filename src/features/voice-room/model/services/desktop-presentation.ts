import {tauri} from '@/shared/api/tauri';
import type {PresentationCaptureQuality} from '@/shared/types/presentation';

const capture = tauri.commands.presentation;
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export const desktopPresentation = {
 available: tauri.isTauri,
 sources: capture.sources,
 async preview(sourceId: string) {
  return new Blob([await capture.preview(sourceId)], {type: 'image/jpeg'});
 },
 async capture(sourceId: string, quality: PresentationCaptureQuality, isCurrent: () => boolean) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', {alpha: false});
  if (!context || typeof canvas.captureStream !== 'function')
   throw new Error('Не удалось подготовить видео для демонстрации.');
  const id = await capture.start(sourceId, quality);
  const frameIntervalMs = 1000 / quality.frameRate;
  const release = () => capture.stop(id).catch(() => {});
  async function readFrame() {
   const bytes = await capture.frame(id);
   if (!bytes.byteLength) return;
   return createImageBitmap(new Blob([bytes], {type: 'image/jpeg'}));
  }
  function draw(frame: ImageBitmap) {
   const scale = Math.min(canvas.width / frame.width, canvas.height / frame.height);
   const width = frame.width * scale;
   const height = frame.height * scale;
   context!.clearRect(0, 0, canvas.width, canvas.height);
   context!.drawImage(frame, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
  }

  try {
   const deadline = performance.now() + 2500;
   while (isCurrent() && performance.now() < deadline) {
    const frame = await readFrame();
    if (frame) {
     if (!isCurrent()) {
      frame.close();
      break;
     }
     canvas.width = frame.width;
     canvas.height = frame.height;
     const [track] = canvas.captureStream(0).getVideoTracks() as CanvasCaptureMediaStreamTrack[];
     try {
      if (!track) throw new Error('Не удалось создать видеодорожку демонстрации.');
      track.requestFrame();
      draw(frame);
     } finally {
      frame.close();
     }
     function end() {
      if (track.readyState === 'ended') return;
      track.stop();
      track.dispatchEvent(new Event('ended'));
     }
     void (async () => {
      let nextReadAt = performance.now() + frameIntervalMs;
      try {
       while (isCurrent() && track.readyState === 'live') {
        const remaining = nextReadAt - performance.now();
        if (remaining > 0) await sleep(remaining);
        if (!isCurrent() || track.readyState !== 'live') break;
        // A delayed read consumes the latest native frame without replaying missed ticks.
        nextReadAt = performance.now() + frameIntervalMs;
        const next = await readFrame();
        if (!next) continue;
        try {
         if (isCurrent() && track.readyState === 'live') {
          track.requestFrame();
          draw(next);
         }
        } finally {
         next.close();
        }
       }
      } catch {
       end();
      } finally {
       await release();
      }
     })();
     return track;
    }
    await sleep(33);
   }
   throw new Error('Источник не передал изображение. Проверьте, что окно открыто.');
  } catch (error) {
   await release();
   throw error instanceof Error ? error : new Error(String(error));
  }
 }
};
