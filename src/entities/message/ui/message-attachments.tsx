import {useRef} from 'react';
import {Download, FileWarning, RotateCw, X} from 'lucide-react';
import {Dialog} from 'radix-ui';
import {type MessageAttachmentMetadata} from '@/shared/types';
import {cacheNote} from '../model/message-attachment-rules';
import {useMessageAttachment} from '../model/use-message-attachment';
import {useAttachmentAudio} from '../model/use-attachment-audio';
import {
 AudioPlayer,
 FileDownload,
 FileIconDisplay,
 FileName,
 FileRoot,
 FileSize,
 fileLabel
} from '@/shared/ui/elements-media';
import './message-attachments.css';

export type MessageAttachmentProps = {messageId: string; attachment: MessageAttachmentMetadata};

export function MessageAttachment(props: MessageAttachmentProps) {
 // Identity key resets only for a different file, not every history poll.
 return <AttachmentView key={props.messageId + ':' + props.attachment.id} {...props} />;
}

/** Компонент только показывает: доступность, предпросмотр и скачивание приходят из модели. */
function AttachmentView({messageId, attachment}: MessageAttachmentProps) {
 const root = useRef<HTMLDivElement>(null);
 const trigger = useRef<HTMLButtonElement>(null);
 const {isImage, isAudio, available, preview, error, busy, open, actions} = useMessageAttachment({
  messageId,
  attachment,
  root
 });

 if (isImage) {
  const placeholder = (
   <span className="attachment-image-placeholder" role="status">
    {!available ? (
     <>
      <FileWarning aria-hidden="true" />
      Изображение недоступно
     </>
    ) : error ? (
     'Не удалось загрузить изображение'
    ) : (
     'Загрузка изображения…'
    )}
   </span>
  );
  const downloadButton = (
   <button
    type="button"
    className="attachment-image-download"
    disabled={busy}
    aria-label={`Скачать ${attachment.name}`}
    title="Скачать изображение"
    onClick={event => {
     event.stopPropagation();
     actions.download();
    }}
   >
    <Download size={18} />
   </button>
  );
  return (
   <div ref={root} className="message-attachment message-attachment-image" aria-label="Изображение">
    <div className="attachment-image-surface">
     <button
      ref={trigger}
      type="button"
      className="attachment-preview attachment-image-trigger"
      disabled={!available}
      aria-label={`Открыть фото ${attachment.name}`}
      onClick={() => actions.setOpen(true)}
     >
      {available && preview && !error ? (
       <img
        src={preview}
        alt="Изображение из переписки"
        onError={() => actions.setError('Не удалось показать изображение.')}
       />
      ) : (
       placeholder
      )}
     </button>
     {available && downloadButton}
     {available && error && (
      <button
       type="button"
       className="attachment-image-retry"
       aria-label="Повторить загрузку изображения"
       onClick={actions.retry}
      >
       <RotateCw size={18} />
      </button>
     )}
    </div>
    {attachment.cached && <p className="attachment-cache-status">{cacheNote(attachment)}</p>}
    <Dialog.Root open={open && available} onOpenChange={actions.setOpen}>
     <Dialog.Portal>
      <Dialog.Overlay className="attachment-viewer-overlay" />
      <Dialog.Content
       className="attachment-viewer material-viewer"
       onCloseAutoFocus={event => {
        event.preventDefault();
        trigger.current?.focus();
       }}
      >
       <Dialog.Title className="attachment-visually-hidden">Просмотр изображения</Dialog.Title>
       <Dialog.Description className="attachment-visually-hidden">
        Изображение из переписки. Нажмите Escape, чтобы закрыть просмотр.
       </Dialog.Description>
       <Dialog.Close asChild>
        <button type="button" className="attachment-viewer-close" aria-label="Закрыть просмотр фото">
         <X size={20} />
        </button>
       </Dialog.Close>
       <div className="attachment-viewer-image">
        {preview && !error ? (
         <img
          src={preview}
          alt="Изображение из переписки"
          onError={() => actions.setError('Не удалось показать изображение.')}
         />
        ) : (
         placeholder
        )}
        {downloadButton}
        {error && (
         <button
          type="button"
          className="attachment-image-retry"
          aria-label="Повторить загрузку изображения"
          onClick={actions.retry}
         >
          <RotateCw size={18} />
         </button>
        )}
       </div>
      </Dialog.Content>
     </Dialog.Portal>
    </Dialog.Root>
   </div>
  );
 }
 if (isAudio && available)
  return (
   <div ref={root} className="message-attachment message-attachment-card" aria-label="Аудио">
    <AttachmentAudio messageId={messageId} attachment={attachment} />
   </div>
  );
 return (
  <div ref={root} className="message-attachment message-attachment-card" aria-label="Вложение">
   <FileCard
    mime={attachment.mime}
    name={attachment.name}
    size={attachment.size}
    available={available}
    note={!available ? 'Файл больше недоступен' : undefined}
    busy={busy}
    onDownload={() => {
     actions.download();
    }}
   />
   {attachment.cached && <p className="attachment-cache-status">{cacheNote(attachment)}</p>}
   {error && available && (
    <p className="attachment-error" role="status">
     {error}
    </p>
   )}
  </div>
 );
}

type FileCardProps = {
 mime: string;
 name: string;
 size: number;
 available: boolean;
 note?: string;
 busy?: boolean;
 onDownload?: () => void;
};
/** assistant-ui Elements File surface; Sombra supplies size/name and its own safe download. */
function FileCard({mime, name, size, available, note, busy, onDownload}: FileCardProps) {
 return (
  <FileRoot className="attachment-file-card bg-background w-full">
   {available ? (
    <FileIconDisplay mimeType={mime} />
   ) : (
    <FileIconDisplay>
     <FileWarning className="size-5" />
    </FileIconDisplay>
   )}
   <div className="flex min-w-0 flex-1 flex-col gap-0.5">
    <FileName title={name}>{name || fileLabel(mime)}</FileName>
    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5">
     <FileSize bytes={size} className="text-xs" />
     {note && <span className="text-muted-foreground text-xs">{note}</span>}
    </span>
   </div>
   {available && onDownload && <FileDownload filename={name} busy={busy} onDownload={onDownload} className="size-8" />}
  </FileRoot>
 );
}

/** Аудио: байты декодируются один раз через общий кэш и делятся между карточками. */
function AttachmentAudio({messageId, attachment}: MessageAttachmentProps) {
 const root = useRef<HTMLDivElement>(null);
 const {url, error, failed, busy, visible, actions} = useAttachmentAudio({messageId, attachment, root});
 // Плеер показывается только для подтверждённого URL; здесь это чистое представление.
 const player = !!url && !failed;
 return (
  <div ref={root} className="attachment-audio">
   {player ? (
    <>
     <div className="attachment-player">
      <AudioPlayer
       src={url}
       title={attachment.name}
       className="dark:bg-background"
       onPlaybackStateChange={actions.setPlaying}
       onPlaybackError={actions.playbackFailed}
      />
      <button
       type="button"
       className="attachment-player-download"
       disabled={busy}
       aria-label={`Скачать ${attachment.name}`}
       title="Скачать аудиофайл"
       onClick={event => {
        event.stopPropagation();
        actions.download();
       }}
      >
       <Download size={16} />
      </button>
     </div>
     <div className="attachment-audio-meta">
      <FileSize bytes={attachment.size} />
      {attachment.cached ? <span>· {cacheNote(attachment)}</span> : null}
     </div>
    </>
   ) : (
    <FileCard
     mime={attachment.mime}
     name={attachment.name}
     size={attachment.size}
     available
     note={!error && visible ? 'Загрузка аудио…' : undefined}
     busy={busy}
     onDownload={() => {
      actions.download();
     }}
    />
   )}
   {error && (
    <div className="attachment-audio-status">
     <p className="attachment-error" role="status">
      {error}
     </p>
     {!player && !failed && (
      <button
       type="button"
       className="attachment-audio-retry"
       aria-label="Повторить загрузку аудио"
       title="Повторить загрузку"
       onClick={actions.retry}
      >
       <RotateCw size={16} />
      </button>
     )}
    </div>
   )}
  </div>
 );
}
