import type {RefObject} from 'react';
import {Dialog} from 'radix-ui';
import {X} from 'lucide-react';
import {type ChatState, type ChatMessage} from '@/shared/types';
import {UserAvatar} from '@/shared/ui/user-avatar';
import {useMessageReaders} from '../model/use-message-readers';
import './message-readers-dialog.css';
export function MessageReadersDialog({
 state,
 message,
 trigger,
 onClose
}: {
 state: Pick<ChatState, 'me' | 'users' | 'readReceiptsSupported'>;
 message: ChatMessage;
 trigger: RefObject<HTMLElement | null>;
 onClose: () => void;
}) {
 const model = useMessageReaders({state, message, onClose});
 return (
  <Dialog.Root
   open
   onOpenChange={open => {
    if (!open) onClose();
   }}
  >
   <Dialog.Portal>
    <Dialog.Overlay className="readers-overlay" />
    <Dialog.Content
     className="readers-dialog fixed top-1/2 left-1/2 z-[111] max-h-[80dvh] w-[min(400px,calc(100%_-_32px))] -translate-x-1/2 -translate-y-1/2 overflow-auto p-5"
     aria-describedby={undefined}
     onCloseAutoFocus={event => {
      event.preventDefault();
      trigger.current?.focus({preventScroll: true});
     }}
    >
     <header className="flex items-center justify-between gap-4">
      <Dialog.Title className="text-base font-semibold">Кто посмотрел</Dialog.Title>
      <Dialog.Close className="min-h-11 min-w-11" aria-label="Закрыть">
       <X size={20} />
      </Dialog.Close>
     </header>
     {model.error ? (
      <div role="alert">
       <p>{model.error}</p>
       <button type="button" className="min-h-11 min-w-11" onClick={model.actions.retry}>
        Повторить
       </button>
      </div>
     ) : model.readers === null ? (
      <p role="status">Загрузка…</p>
     ) : model.rows.length ? (
      <ul className="m-0 mt-3 list-none p-0">
       {model.rows.map(reader => (
        <li key={reader.id} className="flex items-center gap-3 py-3">
         <UserAvatar user={reader.user} size="sm" presence={false} decoration={reader.decoration} />
         <div className="min-w-0">
          <strong className="block text-sm [overflow-wrap:anywhere]">{reader.name}</strong>
          <time className="text-muted-foreground block text-xs" dateTime={reader.iso}>
           {reader.label}
          </time>
         </div>
        </li>
       ))}
      </ul>
     ) : (
      <p>Пока никто не посмотрел.</p>
     )}
    </Dialog.Content>
   </Dialog.Portal>
  </Dialog.Root>
 );
}
