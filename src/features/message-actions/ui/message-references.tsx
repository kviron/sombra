import {TooltipLabel} from '@/shared/ui/tooltip';
import {Input} from '@/shared/ui/input';
import {Button} from '@/shared/ui/button';
import {paper} from '@/shared/ui/elements-composer';
import {UserRow} from '@/entities/user';
import '@/shared/ui/menu-material.css';
import {Dialog} from 'radix-ui';
import {Forward, Hash, Reply, Search, Volume2, X} from 'lucide-react';
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
  <span>
   <strong>{userName(reply.author)}</strong>
   <small>{reply.text || 'Сообщение без текста'}</small>
  </span>
 );
 return onJump ? (
  <TooltipLabel content="Перейти к исходному сообщению">
   <button type="button" className="message-reference" onClick={onJump}>
    {content}
   </button>
  </TooltipLabel>
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
  <div className={`reference-draft ${paper}`}>
   <Icon size={17} aria-hidden="true" />
   <span>
    <strong>
     {kind === 'reply' ? 'Ответ' : 'Пересылка'} · {author}
    </strong>
    <small>{messagePreview(message)}</small>
   </span>
   <TooltipLabel content="Отменить">
    <button
     type="button"
     aria-label={kind === 'reply' ? 'Отменить ответ' : 'Отменить пересылку'}
     onClick={onCancel}
     disabled={disabled}
    >
     <X size={17} />
    </button>
   </TooltipLabel>
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
    <Dialog.Content className="sombra-picker-material border-border fixed top-1/2 left-1/2 z-[101] flex max-h-[85dvh] w-[min(430px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 overflow-y-auto rounded-xl border p-4 shadow-xl">
     <header className="flex shrink-0 items-center justify-between gap-2">
      <Dialog.Title className="text-lg font-semibold">Переслать сообщение</Dialog.Title>
      <Dialog.Close asChild>
       <Button type="button" variant="ghost" size="icon-sm" aria-label="Закрыть">
        <X />
       </Button>
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
     <div className="relative shrink-0">
      <Search
       className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
       aria-hidden="true"
      />
      <Input
       autoFocus
       type="search"
       className="pl-9"
       placeholder="Поиск чата или канала"
       aria-label="Поиск чата или канала"
       value={model.query}
       onChange={event => model.actions.setQuery(event.target.value)}
      />
     </div>
     <ul
      className="m-0 grid max-h-[min(45dvh,340px)] min-h-0 list-none gap-0.5 overflow-y-auto p-0"
      aria-label="Куда переслать"
     >
      {model.matches.map(item => {
       const Icon = item.voice ? Volume2 : Hash;
       return (
        <li key={item.id}>
         <UserRow
          as="button"
          variant="dialog"
          menu={false}
          presence={!item.group && !!item.peer}
          className="hover:bg-accent focus-visible:bg-accent"
          identity={item.peer ?? {id: item.id, name: item.name, avatar: item.avatar}}
          subtitle={item.group?.name || 'Личные сообщения'}
          avatar={
           item.group && (
            <span className="bg-muted text-muted-foreground grid size-10 shrink-0 place-items-center rounded-full">
             <Icon className="size-5" aria-hidden="true" />
            </span>
           )
          }
          onClick={() => onChoose(item)}
         />
        </li>
       );
      })}
     </ul>
     {!model.matches.length && (
      <p className="text-muted-foreground px-2 py-1 text-sm" role="status">
       {model.emptyText}
      </p>
     )}
    </Dialog.Content>
   </Dialog.Portal>
  </Dialog.Root>
 );
}
