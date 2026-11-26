import {useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject} from 'react';
import {Download, EllipsisVertical, X} from 'lucide-react';
import {Dialog} from 'radix-ui';
import {Button} from '@/shared/ui/button';
import type {AttachmentActionId, AttachmentActionItem} from '../model/message-attachment-rules';
import {AttachmentContextMenu, type AttachmentMenuPosition} from './attachment-context-menu';

const iconButton =
 'size-11 rounded-full bg-popover text-primary hover:bg-accent hover:text-primary aria-expanded:bg-accent aria-expanded:text-primary';
// Четыре обычных шага колеса по 120 пикселей удваивают масштаб.
const doubleSizeDelta = 480;
const sentDate = new Intl.DateTimeFormat('ru-RU', {dateStyle: 'short', timeStyle: 'short'});

type AttachmentImageViewerProps = {
 name: string;
 authorName?: string;
 sentAt?: number;
 thumbnail: RefObject<HTMLButtonElement | null>;
 items: AttachmentActionItem[];
 onSelect: (id: AttachmentActionId) => void;
 canZoom: boolean;
 onDismiss: () => void;
 copyError: string;
 children: ReactNode;
};

export function AttachmentImageViewer({
 name,
 authorName,
 sentAt,
 thumbnail,
 items,
 onSelect,
 canZoom,
 onDismiss,
 copyError,
 children
}: AttachmentImageViewerProps) {
 const [content, setContent] = useState<HTMLDivElement | null>(null);
 const stage = useRef<HTMLDivElement>(null);
 const center = useRef({x: 0.5, y: 0.5});
 const [zoom, setZoom] = useState(1);
 const more = useRef<HTMLButtonElement>(null);
 const [menu, setMenu] = useState<AttachmentMenuPosition>();
 const caption = [authorName, sentAt !== undefined && sentDate.format(sentAt * 1000)].filter(Boolean).join(' · ');
 const download = items.find(item => item.id === 'download');

 useEffect(() => {
  if (!content) return;
  function wheel(event: WheelEvent) {
   const area = stage.current;
   if (!area || !event.ctrlKey) return;
   event.preventDefault();
   event.stopPropagation();
   if (!canZoom || !event.deltaY) return;
   const unit =
    event.deltaMode === WheelEvent.DOM_DELTA_LINE
     ? 16
     : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
       ? area.clientHeight
       : 1;
   const delta = Math.max(-0.5, Math.min(0.5, (event.deltaY * unit) / doubleSizeDelta));
   center.current = {
    x: (area.scrollLeft + area.clientWidth / 2) / area.scrollWidth,
    y: (area.scrollTop + area.clientHeight / 2) / area.scrollHeight
   };
   setZoom(value => Math.max(0.25, Math.min(8, value * 2 ** -delta)));
  }
  // Делегированный wheel в React пассивен. Здесь нужно отменить масштабирование всего WebView.
  content.addEventListener('wheel', wheel, {passive: false});
  return () => content.removeEventListener('wheel', wheel);
 }, [content, canZoom]);

 useLayoutEffect(() => {
  const area = stage.current;
  if (!area) return;
  area.scrollLeft = center.current.x * area.scrollWidth - area.clientWidth / 2;
  area.scrollTop = center.current.y * area.scrollHeight - area.clientHeight / 2;
 }, [zoom]);

 return (
  <Dialog.Portal>
   <Dialog.Overlay className="attachment-viewer-overlay bg-background/90 fixed inset-0 z-[140]" />
   <Dialog.Content
    ref={setContent}
    className="attachment-viewer text-foreground fixed inset-0 z-[141] overflow-hidden bg-transparent outline-none"
    onCloseAutoFocus={event => {
     event.preventDefault();
     thumbnail.current?.focus({preventScroll: true});
    }}
    onEscapeKeyDown={event => {
     if (menu) {
      event.preventDefault();
      setMenu(undefined);
     }
    }}
    onContextMenu={event => {
     event.preventDefault();
     event.stopPropagation();
    }}
   >
    <Dialog.Title className="sr-only">Просмотр изображения</Dialog.Title>
    <Dialog.Description className="sr-only">
     {name}. Ctrl и колесо мыши меняют масштаб. Escape закрывает просмотр.
    </Dialog.Description>
    <Dialog.Close asChild>
     <Button
      type="button"
      variant="ghost"
      size="icon"
      className={
       iconButton +
       ' attachment-viewer-close fixed top-[max(.5rem,env(safe-area-inset-top))] right-[max(.5rem,env(safe-area-inset-right))] z-10'
      }
      aria-label="Закрыть просмотр фото"
      title="Закрыть просмотр фото"
     >
      <X className="size-5" />
     </Button>
    </Dialog.Close>
    <div
     ref={stage}
     className="attachment-viewer-stage absolute inset-0 flex overflow-auto overscroll-contain"
     onClick={event => {
      if (event.target === event.currentTarget && !menu) onDismiss();
     }}
    >
     <div
      className="attachment-viewer-image m-auto grid w-max max-w-[calc(100vw-2rem)] shrink-0 place-items-center"
      style={{zoom: canZoom ? zoom : 1}}
      onContextMenu={event => {
       event.preventDefault();
       event.stopPropagation();
       setMenu({x: event.clientX, y: event.clientY});
      }}
     >
      {children}
     </div>
    </div>
    <footer className="pointer-events-none fixed right-[max(.5rem,env(safe-area-inset-right))] bottom-[max(.5rem,env(safe-area-inset-bottom))] left-[max(.75rem,env(safe-area-inset-left))] z-10 flex items-end justify-between gap-3">
     <div className="bg-background/90 min-w-0 rounded-md px-2 py-1 text-xs">
      <div className="truncate font-medium">{name}</div>
      {caption && <div className="text-muted-foreground truncate">{caption}</div>}
      {copyError && <div role="status">{copyError}</div>}
     </div>
     <div className="pointer-events-auto flex shrink-0 gap-1">
      {download && (
       <Button
        type="button"
        variant="ghost"
        size="icon"
        className={iconButton}
        disabled={download.disabled}
        aria-label={download.label}
        title={download.title}
        onClick={() => onSelect(download.id)}
       >
        <Download className="size-5" />
       </Button>
      )}
      <Button
       type="button"
       ref={more}
       variant="ghost"
       size="icon"
       className={iconButton}
       aria-label="Действия с изображением"
       title="Действия с изображением"
       aria-haspopup="menu"
       aria-expanded={menu !== undefined}
       onClick={() => setMenu(current => (current === 'trigger' ? undefined : 'trigger'))}
      >
       <EllipsisVertical className="size-5" />
      </Button>
     </div>
    </footer>
    {menu && (
     <AttachmentContextMenu
      position={menu}
      container={content}
      items={items}
      label={`Действия с изображением ${name}`}
      returnFocus={more}
      onClose={() => setMenu(undefined)}
      onSelect={onSelect}
     />
    )}
   </Dialog.Content>
  </Dialog.Portal>
 );
}
