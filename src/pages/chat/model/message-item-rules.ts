// Чистые правила карточки сообщения: группировка, права, реакции, меню и время.
// Файл намеренно не импортирует ничего, кроме типов: так его читает node --experimental-strip-types.
import type {ChatMessage, ChatState, User} from '@/shared/types';

/** Быстрые реакции карточки: порядок задаёт вид меню. */
export const reactionEmojis = ['👍', '❤️', '😂', '🔥', '🎉', '👀'];

/** Вложение показывается картинкой, а не карточкой файла. */
export const imageMimes = ['image/gif', 'image/png', 'image/jpeg', 'image/webp'];

export type MessageActionId = 'reply' | 'forward' | 'readers' | 'edit' | 'copy' | 'delete';
export type MessageAction = {id: MessageActionId; label: string; disabled?: boolean};

export type ReactionView = {emoji: string; count: number; pressed: boolean; reactors: string[]};

/** Соседние сообщения одного автора склеиваются, в пределах одного дня. */
export function isGrouped(previous: ChatMessage | undefined, message: ChatMessage) {
 return (
  !!previous &&
  message.time - previous.time >= 0 &&
  previous.channel === message.channel &&
  previous.user === message.user &&
  previous.bot_name === message.bot_name &&
  new Date(previous.time * 1000).toDateString() === new Date(message.time * 1000).toDateString()
 );
}

export function groupMessages(messages: readonly ChatMessage[]): ChatMessage[][] {
 const groups: ChatMessage[][] = [];
 let current: ChatMessage[] | undefined;
 for (const message of messages) {
  if (!current || !isGrouped(current.at(-1), message)) {
   current = [];
   groups.push(current);
  }
  current.push(message);
 }
 return groups;
}

export const isAuthor = (message: ChatMessage, me: string) => message.user === me && !message.bot_name;

/** Удалить для всех может автор или участник с правом группы. */
export const canDeleteEveryone = (author: boolean, groupPermission: boolean) => author || groupPermission;

export const hasText = (message: ChatMessage) => !!message.text?.trim();

export const isImageAttachment = (mime: string | undefined) => !!mime && imageMimes.includes(mime);

/** Имя автора: участник важнее подписи бота и запасного имени. */
export const authorName = (identity: User | undefined, message: ChatMessage, fallback: string) =>
 identity?.name || message.bot_name || fallback;

/** Галочка прочтения ставится только своему сообщению и при поддержке сервером. */
export const showsRead = (readReceiptsSupported: boolean | undefined, author: boolean, readCount: number | undefined) =>
 readReceiptsSupported === true && author && (readCount || 0) > 0;

/** Состояние реакции: сколько всего и поставил ли её текущий аккаунт. */
export function reactionViews(reactions: ChatMessage['reactions'], me: string): ReactionView[] {
 return reactionEmojis.flatMap(emoji => {
  const rows = reactions?.filter(reaction => reaction.emoji === emoji) ?? [];
  return rows.length
   ? [
      {
       emoji,
       count: rows.length,
       pressed: rows.some(reaction => reaction.user === me),
       reactors: rows.length <= 3 ? rows.map(row => row.user) : []
      }
     ]
   : [];
 });
}

type MenuArgs = {
 hasReply: boolean;
 hasForward: boolean;
 hasText: boolean;
 author: boolean;
 forwarded: boolean;
 readSupported: boolean;
 read: boolean;
 readCount: number;
};

/** Меню действий: порядок и подписи — правило карточки, а не разметки. */
export function messageMenu({
 hasReply,
 hasForward,
 hasText,
 author,
 forwarded,
 readSupported,
 read,
 readCount
}: MenuArgs): MessageAction[] {
 const actions: MessageAction[] = [];
 if (hasReply) actions.push({id: 'reply', label: 'Ответить'});
 if (hasForward) actions.push({id: 'forward', label: 'Переслать'});
 if (readSupported && author)
  actions.push({
   id: 'readers',
   label: read ? `Посмотрели: ${readCount}` : 'Пока не просмотрено',
   disabled: !read
  });
 // Пересланное не редактируется: исходный текст живёт в другом месте.
 if (author && hasText && !forwarded) actions.push({id: 'edit', label: 'Редактировать'});
 if (hasText) actions.push({id: 'copy', label: 'Копировать текст'});
 actions.push({id: 'delete', label: 'Удалить сообщение'});
 return actions;
}

export const messageTime = (time: number) =>
 new Date(time * 1000).toLocaleTimeString('ru', {hour: '2-digit', minute: '2-digit'});

export const messageDateTime = (time: number) => new Date(time * 1000).toISOString();

/** Подсказка у галочки: сервер объясняет, кто и когда посмотрел сообщение. */
export const readTitle = (message: ChatMessage) =>
 `Посмотрели: ${message.readCount}${message.readAt ? ' · ' + new Date(message.readAt * 1000).toLocaleString('ru') : ''}`;

/** Автор сообщения из снапшота: по нему карточка рисует аватар и открывает профиль. */
export const authorIdentity = (state: ChatState, message: ChatMessage) =>
 state.users.find(user => user.id === message.user);
