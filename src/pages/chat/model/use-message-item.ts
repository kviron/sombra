import {useRef, useState} from 'react';
import {useStore} from 'zustand';
import type {ChatMessage} from '@/shared/types';
import {getMessageAttachments} from '@/shared/lib/message-attachments';
import {useOpenProfile} from '@/shared/lib/user-actions';
import {chatHistoryActions} from './chat-history';
import {failedMessageHint, isLocalMessage} from './chat-rules';
import {
 authorIdentity,
 authorName,
 canDeleteEveryone,
 hasText,
 isAuthor,
 isGrouped,
 isImageAttachment,
 messageDateTime,
 messageMenu,
 messageTime,
 reactionViews,
 readTitle,
 showsRead
} from './message-item-rules';
import type {MessageActionId} from './message-item-rules';
import type {MessageRowState} from './message-item';
import {createMessageItemModel} from './message-item';

type Options = {
 message: ChatMessage;
 previous?: ChatMessage;
 state: MessageRowState;
 refresh: () => Promise<unknown>;
 onError: (message: string) => void;
 userName: (id: string) => string;
 onReply?: (message: ChatMessage) => void;
 onForward?: (message: ChatMessage) => void;
 onJump?: (id: string) => void;
 /** Оптимистичная отправка: пока сервер не ответил, статус рисуется вместо галочек. */
 pending?: 'sending' | 'failed';
 pendingError?: string;
 onRetry?: () => void;
};

/**
 * Единственное место, где живёт логика карточки сообщения: группировка, права,
 * реакции, меню действий и открытые окна. Компонент получает данные и колбэки.
 */
export function useMessageItem({
 message,
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
}: Options) {
 const [model] = useState(createMessageItemModel);
 const item = useStore(model.store);
 const showProfile = useOpenProfile();
 const row = useRef<HTMLElement>(null);

 const grouped = isGrouped(previous, message);
 const sticker = state.stickers?.find(row => row.id === message.sticker);
 const author = isAuthor(message, state.me.id);
 const deleteEverywhere = canDeleteEveryone(author, state.canDeleteAny);
 const identity = authorIdentity(state, message);
 const avatar = identity?.avatar;
 const name = authorName(identity, message, userName(message.user));
 const canOpenProfile = !!identity;
 const text = hasText(message);
 const attachments = getMessageAttachments(message);
 const soloImage = attachments.length === 1 && isImageAttachment(attachments[0].mime);
 const reactions = reactionViews(message.reactions, state.me.id);
 const read = showsRead(state.readReceiptsSupported, author, message.readCount);
 // Временное сообщение нельзя ни править, ни пересылать: у него ещё нет серверного id.
 const localOnly = !!pending || isLocalMessage(message.id);
 const reply = message.replyTo;
 const forwardedId = message.forwardedFrom?.author;
 const forwardedAuthor = forwardedId
  ? {
     name: userName(forwardedId),
     openProfile:
      showProfile && (forwardedId === state.me.id || state.users.some(user => user.id === forwardedId))
       ? () => showProfile(forwardedId)
       : undefined
    }
  : undefined;
 const menu = messageMenu({
  hasReply: !!onReply,
  hasForward: !!onForward && !attachments.length && !message.sticker && !message.gif && text,
  hasText: text,
  author,
  forwarded: !!message.forwardedFrom,
  readSupported: state.readReceiptsSupported === true,
  read,
  readCount: message.readCount || 0
 });

 function openProfile() {
  if (canOpenProfile) showProfile?.(message.user);
 }

 function refreshMessage(deleted = false) {
  return chatHistoryActions.refreshMessage(state.me.id, message, deleted, refresh);
 }

 function react(emoji: string) {
  void model.actions.react({message: message.id, emoji, refresh: refreshMessage, onError});
 }

 function run(id: MessageActionId) {
  switch (id) {
   case 'reply':
    onReply?.(message);
    return;
   case 'forward':
    onForward?.(message);
    return;
   case 'readers':
    model.actions.openReaders();
    return;
   case 'edit':
    model.actions.openEdit();
    return;
   case 'copy':
    void model.actions.copyText({text: message.text, onError});
    return;
   case 'delete':
    model.actions.openDelete();
    return;
  }
 }

 return {
  row,
  grouped,
  sticker,
  author,
  canDeleteEveryone: deleteEverywhere,
  identity,
  avatar,
  name,
  canOpenProfile,
  openProfile,
  forwardedAuthor,
  hasText: text,
  attachments,
  soloImage,
  reactions,
  read,
  readTitle: readTitle(message),
  pendingHint: failedMessageHint(pendingError),
  localOnly,
  menu,
  busy: item.busy,
  dialog: item.dialog,
  readersOpen: item.readersOpen,
  time: messageTime(message.time),
  dateTime: messageDateTime(message.time),
  replyOpen: onJump && reply ? () => onJump(reply.id) : undefined,
  actions: {
   react,
   refreshAfterAction: () => refreshMessage(item.dialog === 'delete'),
   run,
   retry: onRetry,
   openReaders: model.actions.openReaders,
   closeDialog: model.actions.closeDialog,
   closeReaders: model.actions.closeReaders
  }
 };
}

export type MessageItemModel = ReturnType<typeof useMessageItem>;
