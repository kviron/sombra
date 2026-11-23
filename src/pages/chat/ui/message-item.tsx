import {Check, CheckCheck, CircleAlert, Eye, Forward, Pencil, Copy, Trash2, Reply} from 'lucide-react';
import {ContextMenu} from 'radix-ui';
import type {ChatMessage, ChatState} from '@/shared/types';
import {EntityContextMenu} from '@/shared/ui/entity-context-menu';
import {
 Message,
 MessageAvatar,
 MessageContent,
 MessageHeader,
 MessageFooter,
 Bubble,
 BubbleContent
} from '@/shared/ui/message';
import {UserAvatar} from '@/shared/ui/user-avatar';
import {cn} from '@/shared/lib';
import {MessageActionDialog} from '@/features/message-actions';
import {MessageReadersDialog} from '@/features/message-actions';
import {MessageQuote} from '@/features/message-actions';
import {SentSticker} from '@/entities/sticker';
import {MessageAttachment, MessageText} from '@/entities/message';
import {useMessageItem} from '../model/use-message-item';
import {reactionEmojis} from '../model/message-item-rules';
import type {MessageActionId} from '../model/message-item-rules';
import './messages.css';

const menuIcons: Record<MessageActionId, typeof Reply> = {
 reply: Reply,
 forward: Forward,
 readers: Eye,
 edit: Pencil,
 copy: Copy,
 delete: Trash2
};

/**
 * Карточка сообщения только показывает: группировка, права, реакции и меню
 * приходят из модели страницы, поэтому здесь нет запросов и обработки ошибок.
 */
export function MessageItem({
 message: m,
 previous,
 state,
 refresh,
 onError,
 userName,
 onReply,
 onForward,
 onJump,
 pending,
 pendingError,
 onRetry
}: {
 message: ChatMessage;
 previous?: ChatMessage;
 userName: (id: string) => string;
 onReply?: (message: ChatMessage) => void;
 onForward?: (message: ChatMessage) => void;
 onJump?: (id: string) => void;
 /** Оптимистичная отправка: пока сервер не ответил, статус рисуется вместо галочек. */
 pending?: 'sending' | 'failed';
 pendingError?: string;
 onRetry?: () => void;
} & {state: ChatState; refresh: () => Promise<unknown>; onError: (message: string) => void}) {
 const model = useMessageItem({
  message: m,
  previous,
  state,
  refresh,
  onError,
  userName,
  onReply,
  onForward,
  onJump,
  pending,
  pendingError,
  onRetry
 });
 const {grouped, sticker, author, localOnly, busy, reactions, actions} = model;
 const menuActions = localOnly
  ? []
  : model.menu.map(item => ({
     label: item.label,
     icon: menuIcons[item.id],
     disabled: item.disabled,
     onSelect: () => actions.run(item.id)
    }));
 const reactionMenu = (
  <ContextMenu.Group aria-label="Реакции" className="flex justify-between gap-1 px-1 py-1">
   {reactionEmojis.map(emoji => (
    <ContextMenu.Item
     key={emoji}
     disabled={busy}
     aria-label={'Реакция ' + emoji}
     onSelect={() => actions.react(emoji)}
     className="data-[highlighted]:bg-accent grid size-8 cursor-default place-items-center rounded-sm text-base outline-none select-none data-[disabled]:opacity-50"
    >
     {emoji}
    </ContextMenu.Item>
   ))}
  </ContextMenu.Group>
 );
 return (
  <>
   <EntityContextMenu controls={localOnly ? undefined : reactionMenu} actions={menuActions}>
    <Message
     ref={model.row}
     data-read-message-id={m.id}
     data-message-id={m.id}
     data-grouped={grouped}
     data-own={author}
     aria-label={model.name}
     align="start"
     tabIndex={0}
     className="focus-visible:outline-ring rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2"
    >
     <MessageAvatar>
      {model.canOpenProfile ? (
       <button type="button" className="avatar-trigger" title={`Профиль ${model.name}`} onClick={model.openProfile}>
        {model.identity ? (
         <UserAvatar
          user={model.identity}
          size="md"
          presence={false}
          decorative
          decoration={grouped ? undefined : model.identity.decorations?.avatar}
         />
        ) : model.avatar ? (
         <img src={model.avatar} alt="" />
        ) : (
         model.name[0]
        )}
       </button>
      ) : model.avatar ? (
       <img src={model.avatar} alt="" />
      ) : (
       model.name[0]
      )}
     </MessageAvatar>
     <MessageContent>
      <Bubble
       className={cn(
        'relative flow-root rounded-[14px_14px_14px_4px] border border-[#ffffff12] bg-[#202630] px-2 py-1 text-[#e3e7ef]'
       )}
       data-inline-time={model.hasText && !m.attachment && !sticker && reactions.length === 0}
       data-sticker-only={!!sticker && !model.hasText}
       data-image-only={model.hasImage && !model.hasText}
       data-image-message={model.hasImage}
      >
       {!grouped && (
        <MessageHeader>
         <strong>
          {model.canOpenProfile ? (
           <button type="button" className="message-author" title={`Профиль ${model.name}`} onClick={model.openProfile}>
            {model.name}
           </button>
          ) : (
           model.name
          )}
         </strong>
         {(m.bot_name || model.identity?.bot) && <small className="bot-badge">БОТ</small>}
        </MessageHeader>
       )}
       {m.replyTo && <MessageQuote reply={m.replyTo} userName={userName} onJump={model.replyOpen} />}
       {m.forwardedFrom && (
        <div className="message-forwarded">
         <Forward size={14} aria-hidden="true" />
         Переслано от {userName(m.forwardedFrom.author)}
        </div>
       )}
       <BubbleContent className="contents">
        {m.text &&
         (model.hasImage ? (
          <div className="message-image-caption rounded-[12px] border border-[#ffffff12] bg-[#202630] px-[10px] pt-[7px] pb-[5px]">
           <MessageText text={m.text} mentions={m.mentions} />
          </div>
         ) : (
          <MessageText text={m.text} mentions={m.mentions} />
         ))}
        {sticker && (
         <SentSticker
          key={sticker.id}
          sticker={sticker}
          user={state.me.id}
          catalog={state.stickerCatalogSupported}
          refresh={refresh}
         />
        )}
        {m.attachment && <MessageAttachment messageId={m.id} attachment={m.attachment} />}
       </BubbleContent>
       <div
        className={
         reactions.length
          ? 'message-bottom-row mt-1 flex items-end justify-between gap-2'
          : 'message-bottom-inline contents'
        }
       >
        {reactions.length > 0 && (
         <div className="reactions">
          {reactions.map(reaction => (
           <button
            type="button"
            disabled={busy}
            aria-label={`Реакция ${reaction.emoji}`}
            aria-pressed={reaction.pressed}
            key={reaction.emoji}
            onClick={() => actions.react(reaction.emoji)}
           >
            {reaction.emoji} {reaction.count}
           </button>
          ))}
         </div>
        )}
        <MessageFooter className="mt-[3px] flex items-center justify-end gap-1 text-[10px] leading-[15px] whitespace-nowrap text-[#adb8ca]">
         <time dateTime={model.dateTime}>{model.time}</time>
         {author &&
          (pending === 'sending' ? (
           <span className="message-pending" role="status" aria-label="Отправляется" />
          ) : pending === 'failed' ? (
           <button
            type="button"
            className="message-retry inline-flex size-[15px] flex-none cursor-pointer items-center justify-center rounded border-0 p-0 text-[#f87171] [background:none]"
            aria-label={model.pendingHint}
            title={model.pendingHint}
            onClick={actions.retry}
           >
            <CircleAlert size={13} aria-hidden="true" />
           </button>
          ) : model.read ? (
           <button
            type="button"
            className="message-read-check"
            aria-label="Просмотрено"
            title={model.readTitle}
            onClick={actions.openReaders}
           >
            <CheckCheck size={13} />
           </button>
          ) : (
           <Check size={13} aria-label="Отправлено" />
          ))}
        </MessageFooter>
       </div>
      </Bubble>
     </MessageContent>
    </Message>
   </EntityContextMenu>
   {model.readersOpen && model.read && (
    <MessageReadersDialog state={state} message={m} trigger={model.row} onClose={actions.closeReaders} />
   )}
   {model.dialog && (
    <MessageActionDialog
     mode={model.dialog}
     message={m}
     author={author}
     canDeleteEveryone={model.canDeleteEveryone}
     trigger={model.row}
     refresh={refresh}
     onClose={actions.closeDialog}
    />
   )}
  </>
 );
}
