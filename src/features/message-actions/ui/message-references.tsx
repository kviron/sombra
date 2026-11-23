import {Dialog} from 'radix-ui';
import {Forward, Hash, MessageCircle, Reply, Search, Volume2, X} from 'lucide-react';
import type {ChatMessage, MessageReply} from '@/shared/types';
import {messagePreview, type ForwardDestination} from '../model/message-references-rules';
import {useForwardPicker} from '../model/use-forward-picker';
import './message-references.css';

export type {ForwardDestination} from '../model/message-references-rules';

export function MessageQuote({
 reply,
 userName,
 onJump
}: {
 reply: MessageReply;
 userName: (id: string) => string;
 onJump?: () => void;
}) {
 if (!reply.author)
  return (
   <div className="message-reference">
    <Reply size={15} aria-hidden="true" />
    Исходное сообщение недоступно
   </div>
  );
 const content = (
  <>
   <Reply size={15} aria-hidden="true" />
   <span>
    <strong>{userName(reply.author)}</strong>
    <small>{reply.text || 'Сообщение без текста'}</small>
   </span>
  </>
 );
 return onJump ? (
  <button type="button" className="message-reference" title="Перейти к исходному сообщению" onClick={onJump}>
   {content}
  </button>
 ) : (
  <div className="message-reference">{content}</div>
 );
}
export function ReferenceDraft({
 kind,
 message,
 author,
 onCancel,
 disabled
}: {
 kind: 'reply' | 'forward';
 message: ChatMessage;
 author: string;
 onCancel: () => void;
 disabled?: boolean;
}) {
 const Icon = kind === 'reply' ? Reply : Forward;
 return (
  <div className="reference-draft">
   <Icon size={17} aria-hidden="true" />
   <span>
    <strong>
     {kind === 'reply' ? 'Ответ' : 'Пересылка'} · {author}
    </strong>
    <small>{messagePreview(message)}</small>
   </span>
   <button
    type="button"
    title="Отменить"
    aria-label={kind === 'reply' ? 'Отменить ответ' : 'Отменить пересылку'}
    onClick={onCancel}
    disabled={disabled}
   >
    <X size={17} />
   </button>
  </div>
 );
}
export function ForwardPicker({
 destinations,
 onClose,
 onChoose,
 source,
 author
}: {
 destinations: ForwardDestination[];
 onClose: () => void;
 onChoose: (item: ForwardDestination) => void;
 source: ChatMessage;
 author: string;
}) {
 const model = useForwardPicker(destinations);
 return (
  <Dialog.Root
   open
   onOpenChange={open => {
    if (!open) onClose();
   }}
  >
   <Dialog.Portal>
    <Dialog.Overlay className="modal-backdrop" />
    <Dialog.Content className="group-modal forward-picker dark surface-matte">
     <header className="text-foreground flex items-center gap-2">
      <Dialog.Title>Переслать сообщение</Dialog.Title>
      <Dialog.Close asChild>
       <button type="button" aria-label="Закрыть">
        <X size={19} />
       </button>
      </Dialog.Close>
     </header>
     <Dialog.Description asChild>
      <div className="message-reference">
       <Forward size={15} aria-hidden="true" />
       <span>
        <strong>{author}</strong>
        <small>{messagePreview(source)}</small>
       </span>
      </div>
     </Dialog.Description>
     <label className="dialog-search w-full">
      <Search size={17} aria-hidden="true" />
      <input
       autoFocus
       placeholder="Поиск чата или канала"
       aria-label="Поиск чата или канала"
       value={model.query}
       onChange={event => model.actions.setQuery(event.target.value)}
      />
     </label>
     <ul className="m-0 grid max-h-[min(45vh,340px)] list-none gap-0.5 overflow-auto p-0" aria-label="Куда переслать">
      {model.matches.map(item => {
       const Icon = item.voice ? Volume2 : item.group ? Hash : MessageCircle;
       return (
        <li key={item.id}>
         <button
          type="button"
          className="text-muted-foreground flex min-h-12 w-full items-center gap-3 rounded-[6px] px-2.5 py-1.5 text-left"
          onClick={() => onChoose(item)}
         >
          <Icon size={18} aria-hidden="true" />
          <span>
           <strong>{item.name}</strong>
           <small>{item.group?.name || 'Личные сообщения'}</small>
          </span>
         </button>
        </li>
       );
      })}
     </ul>
     {!model.matches.length && <p role="status">{model.emptyText}</p>}
    </Dialog.Content>
   </Dialog.Portal>
  </Dialog.Root>
 );
}
