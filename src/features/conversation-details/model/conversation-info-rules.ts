// Чистые правила информации о чате: без обращения к сети и без DOM, поэтому проверяются тестами.
import type {ChatState, Dialog, User} from '@/shared/types';

/** Поиск участника по email выполняет сервер; его ответ кэшируется по ключу запроса. */
export type MemberSearchResult = {key: string; users: User[]; error?: string};

/** Ключ, по которому сбрасывается черновик: другой чат или другой аккаунт — новый черновик. */
export function conversationScope(chat: ChatState, channel: string) {
 return `${chat.me.id}:${channel}`;
}

/** Правило продукта: править чат может владелец группы из 3–10 человек без ботов на сервере с метаданными. */
export function canEditDialog(chat: ChatState, dialog: Dialog | undefined) {
 return (
  chat.dialogMetadataSupported === true &&
  !!dialog &&
  dialog.owner === chat.me.id &&
  !chat.me.bot &&
  dialog.members.length > 2 &&
  dialog.members.length <= 10 &&
  dialog.members.includes(chat.me.id) &&
  dialog.members.every(id => id === chat.me.id || chat.users.some(user => user.id === id && !user.bot))
 );
}

export const isEmailQuery = (query: string) => /^[^\s@]+@[^\s@]+$/.test(query);

export function matchesMember(user: User | undefined, query: string) {
 if (!query) return true;
 if (!user) return false;
 return `${user.name} ${user.username || ''} @${user.username || ''}`.toLocaleLowerCase().includes(query);
}

export function memberSearchKey(chat: ChatState, channel: string, query: string, memberIds: string[]) {
 return `${chat.me.id}:${channel}:${query}:${memberIds.join(',')}`;
}

type VisibleMembers = {
 chat: ChatState;
 channel: string;
 memberIds: string[];
 query: string;
 remote: MemberSearchResult | undefined;
};

/** Каких участников показать: по email — ответ сервера, иначе — фильтр по уже известным людям. */
export function visibleMemberIds({chat, channel, memberIds, query, remote}: VisibleMembers): string[] {
 const normalized = query.trim().toLocaleLowerCase();
 if (isEmailQuery(normalized) && chat.conversationMemberSearchSupported === true) {
  const key = memberSearchKey(chat, channel, normalized, memberIds);
  return remote?.key === key ? remote.users.map(user => user.id) : [];
 }
 return memberIds.filter(id =>
  matchesMember(id === chat.me.id ? chat.me : chat.users.find(user => user.id === id), normalized)
 );
}

type HintArgs = {
 query: string;
 supported: boolean;
 pending: boolean;
 remote: MemberSearchResult | undefined;
 shown: number;
};

/** Что написать под поиском: состояние запроса важнее количества. */
export function memberSearchHint({query, supported, pending, remote, shown}: HintArgs) {
 const normalized = query.trim().toLocaleLowerCase();
 if (pending) return 'Поиск участника…';
 if (isEmailQuery(normalized) && !supported)
  return 'Поиск по email недоступен на этой версии сервера. Используйте имя или логин.';
 if (remote?.error) return remote.error;
 if (normalized && !shown) return 'Участники не найдены';
 if (normalized) return `Найдено: ${shown}`;
 return 'Поиск только среди участников этого чата. Email не отображается.';
}

export function canSaveDialog(name: string, image: string, dialog: Dialog | undefined) {
 const trimmed = name.trim();
 return !!trimmed && trimmed.length <= 60 && (trimmed !== dialog?.name || image !== (dialog?.avatar || ''));
}

/** Какая ошибка относится к устаревшей ревизии: тогда черновик начинается с новой. */
export const isConflict = (error: string) => /CONFLICT|Диалог изменён/i.test(error);
