// Копирование картинки в буфер обмена: используется только готовый blob предпросмотра.
// WebView2 надёжно принимает image/png, поэтому остальные растровые форматы переводятся на холсте.
import {attachmentCopyError} from './message-attachment-rules';

const pngMime = 'image/png';

/** Буфер принимает картинку, только если браузер умеет и `write`, и `ClipboardItem`. */
export function canUseImageClipboard() {
 return (
  typeof navigator !== 'undefined' &&
  typeof navigator.clipboard?.write === 'function' &&
  typeof ClipboardItem !== 'undefined'
 );
}

/** Уже декодированный предпросмотр: blob читается из своего же object URL, без запроса к серверу. */
export async function previewImageBlob(preview: string): Promise<Blob> {
 if (!preview) throw new Error(attachmentCopyError);
 const response = await fetch(preview);
 if (!response.ok) throw new Error(attachmentCopyError);
 const blob = await response.blob();
 if (!blob.size) throw new Error(attachmentCopyError);
 return blob;
}

/** JPEG/WebP/GIF переводятся в PNG; размеры холста повторяют кадр, поэтому пропорции сохраняются. */
export async function pngImageBlob(blob: Blob): Promise<Blob> {
 if (blob.type === pngMime) return blob;
 if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') throw new Error(attachmentCopyError);
 const bitmap = await createImageBitmap(blob);
 try {
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error(attachmentCopyError);
  context.drawImage(bitmap, 0, 0);
  const png = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, pngMime));
  if (!png) throw new Error(attachmentCopyError);
  return png;
 } finally {
  bitmap.close?.();
 }
}

/** Запись в буфер: отказ браузера или недоступный API дают одну понятную ошибку, а не падение. */
export async function copyImageToClipboard(blob: Blob): Promise<void> {
 if (!canUseImageClipboard()) throw new Error(attachmentCopyError);
 try {
  const png = await pngImageBlob(blob);
  await navigator.clipboard.write([new ClipboardItem({[pngMime]: png})]);
 } catch {
  throw new Error(attachmentCopyError);
 }
}
