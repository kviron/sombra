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
 state: ChatState;
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
     className="readers-dialog"
     aria-describedby={undefined}
     onCloseAutoFocus={event => {
      event.preventDefault();
      trigger.current?.focus({preventScroll: true});
     }}
    >
     <header>
      <Dialog.Title>Кто посмотрел</Dialog.Title>
      <Dialog.Close aria-label="Закрыть">
       <X size={20} />
      </Dialog.Close>
     </header>
     {model.error ? (
      <div role="alert">
       <p>{model.error}</p>
       <button type="button" onClick={model.actions.retry}>
        Повторить
       </button>
      </div>
     ) : model.readers === null ? (
      <p role="status">Загрузка…</p>
     ) : model.rows.length ? (
      <ul>
       {model.rows.map(reader => (
        <li key={reader.id}>
         <UserAvatar user={reader.user} size="sm" presence={false} decoration={reader.decoration} />
         <div>
          <strong>{reader.name}</strong>
          <time dateTime={reader.iso}>{reader.label}</time>
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
