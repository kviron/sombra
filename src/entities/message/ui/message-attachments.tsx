import {TooltipLabel} from '@/shared/ui/tooltip';
import {type CSSProperties, useRef, useState} from 'react';
import {Download, FileWarning, ImageOff, RotateCw} from 'lucide-react';
import {Dialog} from 'radix-ui';
import {type MessageAttachmentMetadata} from '@/shared/types';
import {attachmentAlbumRows} from '../model/attachment-album';
import {type AttachmentActionId, attachmentMenuItems, cacheNote} from '../model/message-attachment-rules';
import {useMessageAttachment} from '../model/use-message-attachment';
import {useAttachmentAudio} from '../model/use-attachment-audio';
import {AttachmentImageViewer} from './attachment-image-viewer';
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
const imageAttachmentShell = cn(attachmentShell, 'overflow-visible border-0 bg-transparent');
/** Audio/File — это поверхность Elements; оболочка задаёт только ширину и снимает рамку. */
const cardAttachmentShell = cn(attachmentShell, 'w-80 overflow-visible border-0 bg-transparent');
const retryImageLabel = 'Повторить загрузку изображения';
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

export type MessageAttachmentProps = {
 messageId: string;
 attachment: MessageAttachmentMetadata;
 authorName?: string;
 sentAt?: number;
};

export function MessageAttachment(props: MessageAttachmentProps) {
 // Identity key resets only for a different file, not every history poll.
 return <AttachmentView key={props.messageId + ':' + props.attachment.id} {...props} />;
}

export function MessageAttachments({
 attachments,
 ...props
}: Omit<MessageAttachmentProps, 'attachment'> & {attachments: readonly MessageAttachmentMetadata[]}) {
 return (
  <div className="message-album" role="group" aria-label={`Вложения: ${attachments.length}`}>
   {attachmentAlbumRows(attachments).map(row =>
    row.kind === 'file' ? (
     <MessageAttachment key={row.attachment.id} attachment={row.attachment} {...props} />
    ) : (
     <div
      key={row.photos[0].attachment.id}
      className="message-album-row"
      style={{
       aspectRatio: row.ratio,
       gridTemplateColumns: row.photos.map(photo => `minmax(0, ${photo.ratio}fr)`).join(' ')
      }}
     >
      {row.photos.map(({attachment}) => (
       <MessageAttachment key={attachment.id} attachment={attachment} {...props} />
      ))}
     </div>
    )
   )}
  </div>
 );
}

/** Компонент только показывает: доступность, предпросмотр и скачивание приходят из модели. */
function AttachmentView({messageId, attachment, authorName, sentAt}: MessageAttachmentProps) {
 const root = useRef<HTMLDivElement>(null);
 const trigger = useRef<HTMLButtonElement>(null);
 const [menuAt, setMenuAt] = useState<{x: number; y: number} | undefined>(undefined);
 const {isImage, imageSize, isAudio, available, preview, error, busy, copying, copyError, open, actions} =
  useMessageAttachment({
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
  function selectAction(id: AttachmentActionId) {
   if (id === 'copy') void actions.copy();
   else actions.download();
  }
  const frame = imageSize
   ? ({
      '--photo-width': Math.min(320, imageSize.width, (420 * imageSize.width) / imageSize.height) + 'px',
      '--photo-ratio': imageSize.width + ' / ' + imageSize.height
     } as CSSProperties)
   : undefined;
  const canRetry = available && !!error;
  const placeholder = canRetry ? (
   <span className="absolute inset-0 grid place-items-center overflow-hidden rounded-[inherit] border border-white/10 bg-neutral-950">
    <ImageOff className="size-7 text-neutral-500" strokeWidth={1.5} aria-hidden="true" />
    <span className="attachment-retry-icon absolute grid size-11 place-items-center rounded-full border border-white/30 bg-black text-white">
     <RotateCw size={19} aria-hidden="true" />
    </span>
    <span className="sr-only" role="status">
     Не удалось загрузить изображение
    </span>
   </span>
  ) : (
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
    ) : (
     'Загрузка изображения…'
    )}
   </span>
  );
  return (
   <div
    ref={root}
    className={cn('message-attachment message-attachment-image', imageAttachmentShell)}
    style={frame}
    aria-label="Изображение"
   >
    <div
     className="attachment-image-surface relative max-w-full"
     onContextMenu={event => {
      // Меню картинки не должно открывать меню сообщения и нативное меню WebView.
      event.preventDefault();
      event.stopPropagation();
      setMenuAt({x: event.clientX, y: event.clientY});
     }}
    >
     <TooltipLabel content={canRetry ? retryImageLabel : 'Открыть фото'}>
      <button
       ref={trigger}
       type="button"
       className={cn(
        'attachment-preview attachment-image-trigger',
        'relative grid w-full max-w-full place-items-center',
        'text-muted-foreground overflow-hidden rounded-md border-0 bg-transparent p-0 text-center text-xs leading-[normal]',
        canRetry ? 'attachment-image-retry cursor-pointer' : 'cursor-zoom-in disabled:cursor-default'
       )}
       disabled={!available}
       aria-label={canRetry ? `${retryImageLabel} ${attachment.name}` : `Открыть фото ${attachment.name}`}
       onClick={canRetry ? actions.retry : () => actions.setOpen(true)}
       onKeyDown={event => {
        if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
        event.preventDefault();
        const bounds = event.currentTarget.getBoundingClientRect();
        setMenuAt({x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2});
       }}
      >
       {available && preview && !error ? (
        <img
         className="absolute inset-0 m-auto block h-auto max-h-full w-auto max-w-full object-contain"
         decoding="async"
         src={preview}
         alt="Изображение из переписки"
         onLoad={event => actions.rememberImageSize(event.currentTarget)}
         onError={() => actions.setError('Не удалось показать изображение.')}
        />
       ) : (
        placeholder
       )}
      </button>
     </TooltipLabel>
    </div>
    {attachment.cached && attachment.expired && <p className="attachment-cache-status">{cacheNote(attachment)}</p>}
    {copyError && (
     <p className="attachment-copy-status" role="status">
      {copyError}
     </p>
    )}
    {menuAt && (
     <AttachmentContextMenu
      key={`${menuAt.x}:${menuAt.y}`}
      position={menuAt}
      items={menuItems}
      label={`Действия с изображением ${attachment.name}`}
      returnFocus={trigger}
      onClose={() => setMenuAt(undefined)}
      onSelect={selectAction}
     />
    )}
    <Dialog.Root open={open && available} onOpenChange={actions.setOpen}>
     {open && available && (
      <AttachmentImageViewer
       name={attachment.name}
       authorName={authorName}
       sentAt={sentAt}
       items={menuItems}
       onSelect={selectAction}
       thumbnail={trigger}
       canZoom={!!preview && !error}
       onDismiss={() => actions.setOpen(false)}
       copyError={copyError}
      >
       {preview && !error ? (
        <img
         className="block h-auto max-h-[calc(100dvh-8rem)] w-auto max-w-full object-contain"
         src={preview}
         alt="Изображение из переписки"
         onLoad={event => actions.rememberImageSize(event.currentTarget)}
         onError={() => actions.setError('Не удалось показать изображение.')}
        />
       ) : canRetry ? (
        <button
         type="button"
         className="attachment-image-retry relative aspect-4/3 max-h-[calc(100dvh-8rem)] w-80 max-w-full cursor-pointer overflow-hidden rounded-md border-0 p-0"
         aria-label={retryImageLabel}
         onClick={actions.retry}
        >
         {placeholder}
        </button>
       ) : (
        placeholder
       )}
      </AttachmentImageViewer>
     )}
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
