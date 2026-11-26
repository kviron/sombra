import {TooltipLabel} from '@/shared/ui/tooltip';
import {Check, CheckCheck, Eye, Forward, Pencil, Copy, RefreshCw, Trash2, Reply} from 'lucide-react';
import {ContextMenu} from 'radix-ui';
import type {ChatMessage, ChatState} from '@/shared/types';
import {EntityContextMenu} from '@/shared/ui/entity-context-menu';
import {Message, MessageAvatar, MessageContent, MessageHeader, MessageFooter} from '@/shared/ui/message';
import {Bubble, BubbleContent} from '@/shared/ui/bubble';
import {MessageReactions} from './message-reactions';
import {Button} from '@/shared/ui/button';
import {UserAvatar} from '@/shared/ui/user-avatar';
import {MessageActionDialog} from '@/features/message-actions';
import {MessageReadersDialog} from '@/features/message-actions';
import {MessageQuote} from '@/features/message-actions';
import {SentSticker} from '@/entities/sticker';
import {MessageAttachment, MessageText} from '@/entities/message';
import {readVoiceInvitation} from '@/features/voice-room';
import {chatNavigationActions} from '../model/chat-navigation';
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
 showAvatar = true,
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
 showAvatar?: boolean;
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
 const invitation = m.text ? readVoiceInvitation(m.text) : null;
 const invitedGroup = invitation && state.groups.find(group => group.id === invitation.group);
 const invitedChannel =
  invitedGroup && invitedGroup.channels.find(channel => channel.kind === 'voice' && channel.id === invitation.channel);
 const bubbleVariant = model.hasImage || (sticker && !model.hasText) ? 'ghost' : author ? 'default' : 'muted';
 const header = !grouped && (
  <MessageHeader className="message-meta px-0">
   <strong>
    {model.canOpenProfile ? (
     <TooltipLabel content={`Профиль ${model.name}`}>
      <button type="button" className="message-author" aria-label={`Профиль ${model.name}`} onClick={model.openProfile}>
       {model.name}
      </button>
     </TooltipLabel>
    ) : (
     model.name
    )}
   </strong>
   {(m.bot_name || model.identity?.bot) && <small className="bot-badge rounded px-1 text-[9px]">БОТ</small>}
  </MessageHeader>
 );
 const deliveryMeta = pending !== 'failed' && (
  <span className="message-delivery-meta">
   <time dateTime={model.dateTime}>{model.time}</time>
   {author &&
    (pending === 'sending' ? (
     <span className="message-pending" role="status" aria-label="Отправляется" />
    ) : model.read ? (
     <TooltipLabel content={model.readTitle}>
      <button type="button" className="message-read-check" aria-label="Просмотрено" onClick={actions.openReaders}>
       <CheckCheck size={13} />
      </button>
     </TooltipLabel>
    ) : (
     <Check size={13} aria-label="Отправлено" />
    ))}
  </span>
 );
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
     data-group-end={showAvatar}
     data-own={author}
     aria-label={model.name}
     align="start"
     tabIndex={0}
     className="chat-message focus-visible:outline-ring static w-auto shrink-0 rounded-sm text-inherit focus-visible:outline-2 focus-visible:outline-offset-2"
    >
     <MessageAvatar
      data-avatar-placeholder={!showAvatar || undefined}
      className="message-avatar text-primary min-w-0 place-items-center bg-transparent text-[12px]"
     >
      {showAvatar && (
       <>
        {' '}
        {model.canOpenProfile ? (
         <TooltipLabel content={`Профиль ${model.name}`}>
          <button
           type="button"
           className="avatar-trigger"
           aria-label={`Профиль ${model.name}`}
           onClick={model.openProfile}
          >
           {model.identity ? (
            <UserAvatar
             user={model.identity}
             size="md"
             presence={false}
             decorative
             decoration={model.identity.decorations?.avatar}
            />
           ) : model.avatar ? (
            <img src={model.avatar} alt="" />
           ) : (
            model.name[0]
           )}
          </button>
         </TooltipLabel>
        ) : model.avatar ? (
         <img src={model.avatar} alt="" />
        ) : (
         model.name[0]
        )}
       </>
      )}
     </MessageAvatar>
     <MessageContent className="message-content w-fit gap-0">
      {bubbleVariant === 'ghost' && header}
      <Bubble variant={bubbleVariant} className="max-w-full">
       <BubbleContent data-inline-meta={!!m.text && !m.attachment && !sticker && !reactions.length}>
        {bubbleVariant !== 'ghost' && header}
        {m.replyTo && <MessageQuote reply={m.replyTo} userName={userName} onJump={model.replyOpen} />}
        {model.forwardedAuthor && (
         <div className="message-forwarded">
          <Forward size={14} aria-hidden="true" />
          <span>Переслано от</span>
          {model.forwardedAuthor.openProfile ? (
           <button
            type="button"
            className="message-forwarded-author"
            aria-label={`Открыть профиль ${model.forwardedAuthor.name}`}
            onClick={model.forwardedAuthor.openProfile}
           >
            {model.forwardedAuthor.name}
           </button>
          ) : (
           <span>{model.forwardedAuthor.name}</span>
          )}
         </div>
        )}
        {invitedGroup && invitedChannel ? (
         <div className="grid justify-items-start gap-1.5">
          <span>Голосовой канал «{invitedChannel.name}»</span>
          <Button
           type="button"
           size="sm"
           variant={bubbleVariant === 'default' ? 'secondary' : 'default'}
           onClick={() => chatNavigationActions.openGroup(invitedGroup.id, invitedChannel.id)}
          >
           Открыть канал
          </Button>
         </div>
        ) : invitation ? (
         <span>Голосовой канал недоступен</span>
        ) : (
         m.text && <MessageText text={m.text} mentions={m.mentions} />
        )}
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
        {reactions.length ? (
         <div className="message-bubble-footer">
          <MessageReactions
           reactions={reactions}
           me={state.me}
           users={state.users}
           busy={busy}
           onReact={actions.react}
          />
          {deliveryMeta}
         </div>
        ) : (
         deliveryMeta
        )}
       </BubbleContent>
      </Bubble>
      {pending === 'failed' && (
       <MessageFooter className="gap-1">
        <span className="text-destructive" role="status">
         Ошибка отправки
        </span>
        <TooltipLabel content={model.pendingHint}>
         <Button type="button" variant="ghost" size="icon-xs" aria-label="Повторить отправку" onClick={actions.retry}>
          <RefreshCw aria-hidden="true" />
         </Button>
        </TooltipLabel>
       </MessageFooter>
      )}
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
