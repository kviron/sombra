// Предпросмотр вложений: общий кэш, область аккаунта и единственный путь сохранения файла.
import {toast} from 'sonner';
import {sessionService, tauri} from '@/shared/api';
import {attachmentCacheGeneration, attachmentCacheWriteEpoch} from '@/shared/api/attachment-cache';
import {attachmentDownloadFailure} from '@/shared/lib/attachment-errors';
import type {AttachmentFile} from '@/shared/types';
import {AttachmentPreviewCache} from './attachment-preview-cache';
import {attachmentBlob, previewScopeId, safeAttachmentName} from './message-attachment-rules';
import {messageService} from './services/message-service';

/** Декодированные предпросмотры: base64 не хранится, кэш живёт до смены аккаунта или кэша. */
export const attachmentPreviews = new AttachmentPreviewCache();

let acceptedScope = '';

export const previewScope = () =>
 previewScopeId(sessionService.token(), attachmentCacheGeneration(), attachmentCacheWriteEpoch());

/** Смена аккаунта или локального кэша делает старые предпросмотры недействительными. */
export function syncPreviewScope() {
 const next = previewScope();
 if (next !== acceptedScope) {
  acceptedScope = next;
  attachmentPreviews.clear();
 }
 return next;
}

const resetPreviewScope = () => {
 acceptedScope = '';
 attachmentPreviews.clear();
};
window.addEventListener('authchange', resetPreviewScope);
window.addEventListener('attachmentcachechange', resetPreviewScope);

// Широкая история не держит кэш: не больше трёх одновременных чтений.
let active = 0;
const waiting: Array<() => void> = [];
async function limited<T>(run: () => Promise<T>): Promise<T> {
 if (active >= 3) await new Promise<void>(resolve => waiting.push(resolve));
 active++;
 try {
  return await run();
 } finally {
  active--;
  waiting.shift()?.();
 }
}

/** Единственный путь сохранения: нативное окно Tauri или авторизованный запрос браузера. */
export async function saveAttachment(
 messageId: string,
 attachmentId: string,
 alive: () => boolean
): Promise<string | undefined> {
 if (tauri.isTauri()) return tauri.commands.files.saveAttachment<string>({message: messageId, attachmentId});
 const file = await limited(() =>
  messageService.attachment<AttachmentFile>({message: messageId, attachment_id: attachmentId})
 );
 if (!alive()) return;
 const url = URL.createObjectURL(attachmentBlob(file));
 const anchor = document.createElement('a');
 anchor.href = url;
 anchor.download = safeAttachmentName(file.name);
 anchor.rel = 'noopener';
 document.body.append(anchor);
 try {
  anchor.click();
 } finally {
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
 }
}

export type DownloadOptions = {
 messageId: string;
 attachmentId: string;
 isAlive: () => boolean;
 onBusy: (busy: boolean) => void;
 onError: (error: string) => void;
};

/** Скачивание: состояние кнопки, сообщение об ошибке и разлогин при истёкшей сессии. */
export async function downloadAttachment({messageId, attachmentId, isAlive, onBusy, onError}: DownloadOptions) {
 onBusy(true);
 try {
  const path = await saveAttachment(messageId, attachmentId, isAlive);
  if (isAlive() && path) toast.success('Файл сохранён в Загрузки', {description: path});
 } catch (reason) {
  const failure = attachmentDownloadFailure(reason, 'Не удалось скачать файл.');
  if (failure.authRequired && isAlive()) sessionService.clear();
  if (isAlive()) onError(failure.message);
 } finally {
  if (isAlive()) onBusy(false);
 }
}
