import type {ClipboardEvent} from 'react';
import type {AttachmentDraft} from '@/shared/types';

export const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS = 10;
export type DraftAttachment = {id: string; file: File};

export function attachmentSelectionError(existing: number, files: readonly File[]) {
 if (existing + files.length > MAX_ATTACHMENTS) return 'К одному сообщению можно прикрепить до 10 файлов.';
 const large = files.find(file => file.size > MAX_ATTACHMENT_SIZE);
 return large ? `«${large.name}» превышает 10 МиБ.` : '';
}

export function pastedAttachments(event: ClipboardEvent<HTMLTextAreaElement>): File[] {
 const files = Array.from(event.clipboardData.files);
 if (files.length && !event.clipboardData.getData('text/plain')) event.preventDefault();
 return files;
}

/** Только заголовок файла разрешает растровое превью. */
export function draftImageMime(bytes: Uint8Array): string | undefined {
 const starts = (values: number[]) => values.every((value, index) => bytes[index] === value);
 if (starts([137, 80, 78, 71, 13, 10, 26, 10])) return 'image/png';
 if (starts([255, 216, 255])) return 'image/jpeg';
 if (starts([71, 73, 70, 56]) && (bytes[4] === 55 || bytes[4] === 57) && bytes[5] === 97) return 'image/gif';
 if (starts([82, 73, 70, 70]) && bytes[8] === 87 && bytes[9] === 69 && bytes[10] === 66 && bytes[11] === 80)
  return 'image/webp';
}

/** Base64 создаётся только на время отправки одного файла. */
export function readAttachment(file: File): Promise<AttachmentDraft> {
 return new Promise((resolve, reject) => {
  if (file.size > MAX_ATTACHMENT_SIZE) throw new Error('Размер файла не должен превышать 10 МиБ.');
  const reader = new FileReader();
  reader.onerror = () => reject(new Error('Не удалось прочитать файл.'));
  reader.onabort = () => reject(new Error('Чтение файла отменено.'));
  reader.onload = () => {
   const result = String(reader.result),
    comma = result.indexOf(',');
   if (comma < 0) reject(new Error('Не удалось прочитать файл.'));
   else resolve({name: file.name || 'Вложение', data: result.slice(comma + 1), mime: file.type || undefined});
  };
  reader.readAsDataURL(file);
 });
}
