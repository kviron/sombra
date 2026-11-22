// Чистые правила вложений: размеры, имя файла, ключи предпросмотра — без сети и DOM.
import type {AttachmentFile, MessageAttachmentMetadata} from '@/shared/types';

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const imageMimes = new Set(['image/gif', 'image/png', 'image/jpeg', 'image/webp']);

/** Локальная копия переживает очистку на сервере, поэтому файл ещё доступен. */
export const attachmentAvailable = (attachment: {expired?: boolean; cached?: boolean}) =>
 !attachment.expired || !!attachment.cached;

export const isImageMime = (mime: string) => imageMimes.has(mime);

/** Имя для скачивания: без управляющих и запрещённых в файловой системе символов. */
export function safeAttachmentName(name: string) {
 // eslint-disable-next-line no-control-regex -- управляющие символы недопустимы в имени файла
 return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 240) || 'Вложение';
}

export function cacheNote(attachment: {expired?: boolean}) {
 return attachment.expired ? 'Локальная копия · файл очищен на сервере' : 'Сохранено на этом устройстве';
}

/** Подписи действий над картинкой: одни и те же в меню, кнопках и подсказках. */
export const attachmentActionLabels = {copy: 'Скопировать', download: 'Скачать'} as const;

/** Единственная причина отказа копирования: браузер или WebView не разрешили запись в буфер. */
export const attachmentCopyError = 'Браузер не разрешил скопировать изображение';

export type AttachmentActionId = keyof typeof attachmentActionLabels;

export type AttachmentActionItem = {
 id: AttachmentActionId;
 label: string;
 disabled: boolean;
 /** Причина недоступности или описание действия — показывается в `title`. */
 title: string;
};

export type CopyAvailability = {available: boolean; mime: string; loaded: boolean; copying?: boolean};
export type DownloadAvailability = {available: boolean; saving?: boolean};
export type AttachmentMenuInput = CopyAvailability & DownloadAvailability & {name?: string};

/** Копировать можно только уже загруженную растровую картинку, и не параллельно. */
export const canCopyAttachment = ({available, mime, loaded, copying = false}: CopyAvailability) =>
 available && isImageMime(mime) && loaded && !copying;

/** Скачивание — тот же путь сохранения, что у кнопки скачивания: только для доступного файла. */
export const canDownloadAttachment = ({available, saving = false}: DownloadAvailability) => available && !saving;

/** Пункты контекстного меню картинки: порядок, подписи и причины недоступности в одном месте. */
export function attachmentMenuItems(input: AttachmentMenuInput): AttachmentActionItem[] {
 const {available, mime, loaded, copying = false, saving = false, name = ''} = input;
 const copyReason = !available
  ? 'Файл больше недоступен'
  : !isImageMime(mime)
    ? 'Этот файл нельзя скопировать как изображение'
    : !loaded
      ? 'Изображение ещё не загружено'
      : copying
        ? 'Изображение уже копируется'
        : '';
 const downloadReason = !available ? 'Файл больше недоступен' : saving ? 'Файл уже сохраняется' : '';
 return [
  {
   id: 'copy',
   label: attachmentActionLabels.copy,
   disabled: !!copyReason,
   title: copyReason || 'Скопировать изображение в буфер обмена'
  },
  {
   id: 'download',
   label: attachmentActionLabels.download,
   disabled: !!downloadReason,
   title: downloadReason || `Сохранить ${safeAttachmentName(name)}`
  }
 ];
}

/** Область предпросмотра: аккаунт, поколение кэша и запись в кэш. */
export const previewScopeId = (token: string, generation: number, writeEpoch: number) =>
 JSON.stringify([token, generation, writeEpoch]);

/** Ключ вложения: меняется вместе с файлом и областью аккаунта. */
export function attachmentIdentity(
 scope: string,
 messageId: string,
 attachment: MessageAttachmentMetadata,
 kind?: string
) {
 const key: Array<string | number> = [
  scope,
  messageId,
  attachment.id,
  attachment.name,
  attachment.mime,
  attachment.size
 ];
 if (kind) key.push(kind);
 return JSON.stringify(key);
}

/** Тело вложения из base64: размер проверяется до декодирования. */
export function attachmentBlob(file: AttachmentFile) {
 if (typeof file.data !== 'string' || file.data.length > Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4)
  throw new Error('Некорректный размер вложения.');
 const binary = atob(file.data);
 if (binary.length > MAX_ATTACHMENT_BYTES) throw new Error('Размер вложения превышает 10 МиБ.');
 const bytes = new Uint8Array(binary.length);
 for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
 return new Blob([bytes], {type: imageMimes.has(file.mime) ? file.mime : 'application/octet-stream'});
}
