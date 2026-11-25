import {TooltipLabel} from '@/shared/ui/tooltip';
import {useRef, useState} from 'react';
import {Download, FileWarning, RotateCw, X} from 'lucide-react';
import {Dialog} from 'radix-ui';
import {type MessageAttachmentMetadata} from '@/shared/types';
import {attachmentMenuItems, cacheNote} from '../model/message-attachment-rules';
import {useMessageAttachment} from '../model/use-message-attachment';
import {useAttachmentAudio} from '../model/use-attachment-audio';
import {AttachmentContextMenu} from './attachment-context-menu';
import {
 AudioPlayer,
 FileDownload,
 FileIconDisplay,
 FileName,
 FileRoot,
 FileSize,
 fileLabel
} from '@/shared/ui/elements-media';
import {cn} from '@/shared/lib';
import './message-attachments.css';

/** Оболочка карточки: ширина, отступ, рамка и фон приходят из токенов темы. */
const attachmentShell = 'mt-2 min-w-0 max-w-full rounded-lg border border-border bg-background';
/** Картинка рисует себя сама, поэтому рамку и фон оболочки она снимает. */
const imageAttachmentShell = cn(attachmentShell, 'w-fit overflow-visible border-0 bg-transparent');
/** Audio/File — это поверхность Elements; оболочка задаёт только ширину и снимает рамку. */
const cardAttachmentShell = cn(attachmentShell, 'w-80 overflow-visible border-0 bg-transparent');
/** Действие над картинкой: цель 44×44, тёмная плашка, светлая иконка. */
const imageActionButton =
 'flex size-11 min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md border-0 bg-primary p-1 text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[3px]';
const imageDownloadButton = cn(
 'attachment-image-download',
 imageActionButton,
 'absolute top-2 right-2 pointer-events-none opacity-0 transition-opacity duration-150 ease-[ease]',
 'group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100',
 'disabled:cursor-wait motion-reduce:transition-none'
);
const imageRetryButton = cn('attachment-image-retry', imageActionButton, 'absolute right-2 bottom-2');
const viewerCloseButton = cn(
 'attachment-viewer-close',
 imageActionButton,
 'absolute right-0 top-[max(-48px,calc(-10dvh_+_env(safe-area-inset-top,0px)_+_8px))]'
);
/** Кнопка скачивания аудио: появляется при наведении на плеер. */
const audioDownloadButton = cn(
 'attachment-player-download',
 'absolute top-1.5 right-1.5 z-1 flex size-[30px] min-h-[30px] cursor-pointer items-center justify-center rounded-md border-0 bg-primary p-0 text-foreground',
 'pointer-events-none opacity-0 transition-opacity duration-150 ease-[ease]',
 'group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100',
 'disabled:cursor-wait focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[2px] motion-reduce:transition-none'
);
const audioRetryButton = cn(
 'attachment-audio-retry',
 'flex-none mt-0.5 flex size-8 min-h-8 min-w-8 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 text-muted-foreground'
);

export type MessageAttachmentProps = {messageId: string; attachment: MessageAttachmentMetadata};

export function MessageAttachment(props: MessageAttachmentProps) {
 // Identity key resets only for a different file, not every history poll.
 return <AttachmentView key={props.messageId + ':' + props.attachment.id} {...props} />;
}

/** Компонент только показывает: доступность, предпросмотр и скачивание приходят из модели. */
function AttachmentView({messageId, attachment}: MessageAttachmentProps) {
 const root = useRef<HTMLDivElement>(null);
 const trigger = useRef<HTMLButtonElement>(null);
 const [menuAt, setMenuAt] = useState<{x: number; y: number} | undefined>(undefined);
 const {isImage, isAudio, available, preview, error, busy, copying, copyError, open, actions} = useMessageAttachment({
  messageId,
  attachment,
  root
 });
 const menuItems = attachmentMenuItems({
  available,
  mime: attachment.mime,
  loaded: !!preview && !error,
  copying,
  saving: busy,
  name: attachment.name
 });

 if (isImage) {
  const placeholder = (
   <span
    className={cn(
     'attachment-image-placeholder',
     'text-muted-foreground flex min-h-[120px] items-center justify-center gap-2 p-5 text-xs leading-[normal] whitespace-normal'
    )}
    role="status"
   >
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
   <TooltipLabel content="Скачать изображение">
    <button
     type="button"
     className={imageDownloadButton}
     disabled={busy}
     aria-label={`Скачать ${attachment.name}`}
     onClick={event => {
      event.stopPropagation();
      actions.download();
     }}
    >
     <Download size={18} />
    </button>
   </TooltipLabel>
  );
  return (
   <div
    ref={root}
    className={cn('message-attachment message-attachment-image', imageAttachmentShell)}
    aria-label="Изображение"
   >
    <div
     className={cn('attachment-image-surface', 'group relative max-w-full')}
     onContextMenu={event => {
      // Меню картинки не должно открывать меню сообщения и нативное меню WebView.
      event.preventDefault();
      event.stopPropagation();
      setMenuAt({x: event.clientX, y: event.clientY});
     }}
    >
     <TooltipLabel content="Открыть фото">
      <button
       ref={trigger}
       type="button"
       className={cn(
        'attachment-preview attachment-image-trigger',
        'grid h-auto max-h-[var(--attachment-image-max-height)] min-h-[120px] w-[min(320px,100%)] max-w-full min-w-[min(160px,100%)]',
        'text-muted-foreground cursor-zoom-in place-items-center content-center justify-center overflow-hidden rounded-md border-0 bg-transparent p-0 text-center text-xs leading-[normal]',
        'disabled:cursor-default'
       )}
       disabled={!available}
       aria-label={`Открыть фото ${attachment.name}`}
       onClick={() => actions.setOpen(true)}
       onKeyDown={event => {
        if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
        event.preventDefault();
        const bounds = event.currentTarget.getBoundingClientRect();
        setMenuAt({x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2});
       }}
      >
       {available && preview && !error ? (
        <img
         className={cn('block h-auto max-h-[var(--attachment-image-max-height)] w-auto max-w-full object-contain')}
         src={preview}
         alt="Изображение из переписки"
         onError={() => actions.setError('Не удалось показать изображение.')}
        />
       ) : (
        placeholder
       )}
      </button>
     </TooltipLabel>
     {available && downloadButton}
     {available && error && (
      <button
       type="button"
       className={imageRetryButton}
       aria-label="Повторить загрузку изображения"
       onClick={actions.retry}
      >
       <RotateCw size={18} />
      </button>
     )}
    </div>
    {attachment.cached && <p className="attachment-cache-status">{cacheNote(attachment)}</p>}
    {copyError && (
     <p className="attachment-copy-status" role="status">
      {copyError}
     </p>
    )}
    {menuAt && (
     <AttachmentContextMenu
      key={`${menuAt.x}:${menuAt.y}`}
      x={menuAt.x}
      y={menuAt.y}
      items={menuItems}
      label={`Действия с изображением ${attachment.name}`}
      returnFocus={trigger}
      onClose={() => setMenuAt(undefined)}
      onSelect={id => {
       if (id === 'copy') void actions.copy();
       else actions.download();
      }}
     />
    )}
    <Dialog.Root open={open && available} onOpenChange={actions.setOpen}>
     <Dialog.Portal>
      <Dialog.Overlay className={cn('attachment-viewer-overlay', 'bg-card fixed inset-0 z-[140]')} />
      <Dialog.Content
       className={cn(
        'attachment-viewer material-viewer',
        'fixed top-1/2 left-1/2 z-[141] grid max-h-[90dvh] w-fit max-w-[90vw] -translate-x-1/2 -translate-y-1/2 place-items-center',
        'text-foreground overflow-visible rounded-none border-0 bg-transparent p-0 shadow-none'
       )}
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
        <button type="button" className={viewerCloseButton} aria-label="Закрыть просмотр фото">
         <X size={20} />
        </button>
       </Dialog.Close>
       <div
        className={cn('attachment-viewer-image', 'group relative grid max-h-[80dvh] max-w-[90vw] place-items-center')}
       >
        {preview && !error ? (
         <img
          className={cn('block h-auto max-h-[80dvh] w-auto max-w-[90vw] object-contain')}
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
          className={imageRetryButton}
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
   <div ref={root} className={cn('message-attachment message-attachment-card', cardAttachmentShell)} aria-label="Аудио">
    <AttachmentAudio messageId={messageId} attachment={attachment} />
   </div>
  );
 return (
  <div
   ref={root}
   className={cn('message-attachment message-attachment-card', cardAttachmentShell)}
   aria-label="Вложение"
  >
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
  <FileRoot className={cn('attachment-file-card', 'bg-background w-full min-w-0')}>
   {available ? (
    <FileIconDisplay mimeType={mime} />
   ) : (
    <FileIconDisplay>
     <FileWarning className="size-5" />
    </FileIconDisplay>
   )}
   <div className="flex min-w-0 flex-1 flex-col gap-0.5">
    <TooltipLabel content={name}>
     <FileName>{name || fileLabel(mime)}</FileName>
    </TooltipLabel>
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
  <div ref={root} className={cn('attachment-audio', 'flex max-w-full min-w-0 flex-col')}>
   {player ? (
    <>
     <div className={cn('attachment-player', 'group relative max-w-full min-w-0')}>
      <AudioPlayer
       src={url}
       title={attachment.name}
       className="dark:bg-background"
       onPlaybackStateChange={actions.setPlaying}
       onPlaybackError={actions.playbackFailed}
      />
      <TooltipLabel content="Скачать аудиофайл">
       <button
        type="button"
        className={audioDownloadButton}
        disabled={busy}
        aria-label={`Скачать ${attachment.name}`}
        onClick={event => {
         event.stopPropagation();
         actions.download();
        }}
       >
        <Download size={16} />
       </button>
      </TooltipLabel>
     </div>
     <div
      className={cn(
       'attachment-audio-meta',
       'text-muted-foreground m-0 flex flex-wrap items-center gap-1 px-0.5 pt-1.5 text-[11px] [overflow-wrap:anywhere] whitespace-normal'
      )}
     >
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
    <div className={cn('attachment-audio-status', 'flex items-start gap-2 px-0.5')}>
     <p className="attachment-error" role="status">
      {error}
     </p>
     {!player && !failed && (
      <TooltipLabel content="Повторить загрузку">
       <button type="button" className={audioRetryButton} aria-label="Повторить загрузку аудио" onClick={actions.retry}>
        <RotateCw size={16} />
       </button>
      </TooltipLabel>
     )}
    </div>
   )}
  </div>
 );
}
