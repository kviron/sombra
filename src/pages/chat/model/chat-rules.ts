// Чистые правила страницы чата: без сети, DOM и React, поэтому проверяются тестами.
// Файл намеренно не импортирует ничего, кроме типов: так его читает node --experimental-strip-types.
import type {
 ChatMessage,
 ChatPreferences,
 ChatState,
 Dialog,
 DialogCall,
 DialogPreferences,
 Friend,
 Group,
 User
} from '@/shared/types';
import type {ForwardDestination} from '@/features/message-actions';
import type {FriendStatus} from '@/shared/lib/user-actions';

/** Сколько участников можно выбрать в новом диалоге: сервер ограничивает чат десятью людьми. */
export const SELECT_LIMIT = 9;

export function groupInviteCandidates(users: readonly User[], members: readonly string[]) {
 const existing = new Set(members);
 return users.filter(user => !user.bot && !existing.has(user.id));
}

/** Какая группа показана: выбранная, а если её нет — первая в списке. */
export function currentGroup(state: ChatState | null, groupId: string) {
 return state?.groups.find(group => group.id === groupId) || state?.groups[0];
}

type ChannelArgs = {
 home: boolean;
 state: ChatState | null;
 group: Group | undefined;
 channelId: string;
};

/** Какая переписка или канал показаны: в домашнем режиме — диалог, иначе канал группы. */
export function channelFor({home, state, group, channelId}: ChannelArgs) {
 if (home) return state?.dialogs.find(dialog => dialog.id === channelId);
 return (
  group?.channels.find(channel => channel.id === channelId) ||
  group?.channels.find(channel => channel.name === 'games') ||
  group?.channels[0]
 );
}

export const canShowMembers = (home: boolean, group: Group | undefined) => !home && !!group;

export const isVoiceChannel = (channel: Dialog | Group['channels'][number] | undefined) =>
 !!channel && 'kind' in channel && channel.kind === 'voice';

/** Голосовой расклад: канал голосовой или мы уже в звонке этой переписки. */
export function isVoiceView({
 channel,
 voiceRoom,
 room
}: {
 channel: Dialog | Group['channels'][number] | undefined;
 voiceRoom: string | undefined;
 room: string | undefined;
}) {
 return isVoiceChannel(channel) || !!(voiceRoom && room === voiceRoom);
}

/** Собеседник личной переписки: второй участник диалога из двух человек. */
export function dialogPeer(state: ChatState | null, dialog: Dialog) {
 if (!state) return undefined;
 return state.users.find(user => user.id !== state.me.id && dialog.members.includes(user.id));
}

/** Имя переписки: у личного диалога — имя собеседника, иначе сохранённое название. */
export function dialogName(state: ChatState | null, dialog: Dialog) {
 return dialog.members.length === 2 ? dialogPeer(state, dialog)?.name || dialog.name : dialog.name;
}

export const friendsOpen = (home: boolean, channelId: string) => home && channelId === 'friends';

type TitleArgs = {
 home: boolean;
 state: ChatState | null;
 channel: Dialog | Group['channels'][number] | undefined;
 group: Group | undefined;
 friends: boolean;
};

/** Заголовок шапки чата; порядок проверок важен — режим друзей перекрывает переписку. */
export function chatTitle({home, state, channel, group, friends}: TitleArgs) {
 if (friends) return 'Друзья';
 if (channel) return home ? dialogName(state, channel as Dialog) : channel.name;
 if (home) return 'Выберите переписку';
 return group ? 'Выберите канал' : 'Выберите группу';
}

type PeerArgs = {home: boolean; state: ChatState | null; channel: Dialog | Group['channels'][number] | undefined};

/** Собеседник для шапки личного диалога: только домашний режим и ровно два участника. */
export function dmPeerFor({home, state, channel}: PeerArgs) {
 if (!home || !channel || !('members' in channel) || channel.members.length !== 2) return undefined;
 return dialogPeer(state, channel);
}

/** Бот владельца в личной переписке: только не для бота и только для своего бота. */
export function ownerDmBot(state: ChatState | null, peer: User | undefined) {
 if (!state || !peer?.bot || state.me.bot) return undefined;
 return state.bots?.find(bot => bot.id === peer.id && bot.owner === state.me.id);
}

/** До какого времени показывать «печатает…»: берём самый поздний срок из свежих записей. */
export function peerTypingUntil(state: ChatState | null, peer: User | undefined, channelId: string) {
 if (!state || !peer) return 0;
 const rows = peer.bot
  ? state.botTyping?.filter(row => row.bot === peer.id && row.channel === channelId)
  : state.humanTyping?.filter(row => row.user === peer.id && row.channel === channelId);
 return rows?.reduce((until, row) => (Number.isFinite(row.until) ? Math.max(until, row.until) : until), 0) || 0;
}

/** Последнее сообщение каждого канала: по нему сортируется список переписок. */
export function latestMessages(messages: readonly ChatMessage[]) {
 const latest = new Map<string, ChatMessage>();
 for (const message of messages) {
  const current = latest.get(message.channel);
  if (!current || current.time <= message.time) latest.set(message.channel, message);
 }
 return latest;
}

export function preferencesForDialog(preferences: ChatPreferences | undefined, id: string): DialogPreferences {
 const value = preferences?.dialogs?.[id];
 return {pinned: value?.pinned === true, muted: value?.muted === true};
}

type ListArgs = {state: ChatState | null; search: string};

/** Список переписок: фильтр по имени, закреплённые сверху, дальше по времени последнего сообщения. */
export function dialogList({state, search}: ListArgs) {
 const latest = latestMessages(state?.messages || []);
 const query = search.trim().toLocaleLowerCase();
 const dialogs = (state?.dialogs || [])
  .filter(dialog => dialogName(state, dialog).toLocaleLowerCase().includes(query))
  .sort(
   (a, b) =>
    Number(preferencesForDialog(state?.chatPreferences, b.id).pinned) -
     Number(preferencesForDialog(state?.chatPreferences, a.id).pinned) ||
    (latest.get(b.id)?.time || 0) - (latest.get(a.id)?.time || 0)
  );
 return {latest, dialogs};
}

type EmptyDialogArgs = {search: string; ready: boolean};

/** Что написать вместо пустого списка переписок: поиск важнее состояния загрузки. */
export function dialogEmptyText({search, ready}: EmptyDialogArgs) {
 if (search.trim()) return 'Переписки не найдены';
 return ready ? 'Пока нет переписок. Нажмите +, чтобы начать разговор.' : 'Загрузка переписок…';
}

export const conversationEmptyText = (hasChannel: boolean) =>
 hasChannel
  ? 'Пока тихо. Начните разговор — отправьте первое сообщение.'
  : 'Выберите или создайте комнату, чтобы начать общение.';

export const onlineText = (online: boolean | undefined) => (online ? 'В сети' : 'Не в сети');

export const unreadBadge = (count: number) => (count > 99 ? '99+' : count);

export const unreadLabel = (count: number | undefined) => `Непрочитанных сообщений: ${count}`;

/** Имя участника по идентификатору; неизвестный участник не должен ломать текст. */
export const memberName = (users: readonly User[], id: string) =>
 users.find(user => user.id === id)?.name || 'Участник';

type FilterArgs = {messages: readonly ChatMessage[]; search: string; users: readonly User[]};

/** Поиск по сообщениям учитывает и текст, и автора. */
export function filterMessages({messages, search, users}: FilterArgs) {
 if (!search) return messages;
 const query = search.toLowerCase();
 return messages.filter(message => `${message.text} ${memberName(users, message.user)}`.toLowerCase().includes(query));
}

/** Нужен ли разделитель даты перед сообщением. */
export function startsDay(messages: readonly ChatMessage[], index: number) {
 if (index === 0) return true;
 return (
  new Date(messages[index].time * 1000).toDateString() !== new Date(messages[index - 1].time * 1000).toDateString()
 );
}

export const dayLabel = (time: number) =>
 new Date(time * 1000).toLocaleDateString('ru', {day: 'numeric', month: 'long', year: 'numeric'});

/** Ревизия транскрипта: длина, последнее сообщение и живая картинка бота. */
export const scrollRevision = (ids: readonly string[], imageActivity: boolean) =>
 `${ids.length}:${ids.at(-1) || ''}:${imageActivity}`;

/** Черновик ответа или пересылки принадлежит паре «аккаунт + переписка». */
export const referenceDraftKey = (account: string | undefined, channel: string | undefined) =>
 JSON.stringify([account || '', channel || '']);

type DisabledArgs = {busy: boolean; reading: boolean; hasChannel: boolean; draft: string; attachment: boolean};

/** Кнопка отправки неактивна без текста и вложения, во время чтения файла и общего запрета. */
export function sendDisabled({busy, reading, hasChannel, draft, attachment}: DisabledArgs) {
 return busy || reading || !hasChannel || (!draft.trim() && !attachment);
}

type TypingArgs = {
 state: ChatState | null;
 peer: User | undefined;
 busy: boolean;
 settings: boolean;
 modal: boolean;
 profile: boolean;
 info: boolean;
 botSettings: boolean;
 roles: boolean;
};

/** Печатать «в сети» имеет смысл только в личном диалоге с человеком и без открытых окон. */
export function humanTypingEnabled({
 state,
 peer,
 busy,
 settings,
 modal,
 profile,
 info,
 botSettings,
 roles
}: TypingArgs) {
 return (
  !!state?.humanTypingSupported &&
  !!peer &&
  !peer.bot &&
  !state?.me.bot &&
  !busy &&
  !settings &&
  !modal &&
  !profile &&
  !info &&
  !botSettings &&
  !roles
 );
}

type ReadArgs = {
 settings: boolean;
 modal: boolean;
 profile: boolean;
 headerProfile: boolean;
 info: boolean;
 roles: boolean;
 managedBot: boolean;
 incoming: boolean;
 friends: boolean;
 picker: boolean;
};

/** Открытый диалог или окно перекрывают отметку прочтения: черновик сам по себе не мешает. */
export function readsBlocked({
 settings,
 modal,
 profile,
 headerProfile,
 info,
 roles,
 managedBot,
 incoming,
 friends,
 picker
}: ReadArgs) {
 return settings || modal || profile || headerProfile || info || roles || managedBot || incoming || friends || picker;
}

export const referencesSupported = (state: ChatState | null) => state?.features?.messageReferences === true;

export const canEditGroup = (state: ChatState | null, group: Group | undefined) =>
 !!group && !!state && group.members.includes(state.me.id);

/** Запись о дружбе между текущим пользователем и указанным человеком. */
export function friendRecord(state: ChatState | null, id: string) {
 if (!state) return undefined;
 return state.friends.find(
  friend => (friend.from === id && friend.to === state.me.id) || (friend.to === id && friend.from === state.me.id)
 );
}

export function friendStatus(state: ChatState | null, id: string): FriendStatus {
 if (!state) return 'none';
 if (id === state.me.id) return 'self';
 const friend = friendRecord(state, id);
 if (!friend) return 'none';
 if (friend.accepted) return 'friends';
 return friend.from === state.me.id ? 'outgoing' : 'incoming';
}

export function canRequestFriend(state: ChatState | null, id: string) {
 return !!state && id !== state.me.id && !friendRecord(state, id);
}

const MODAL_TITLES: Record<string, string> = {
 group: 'Создать группу',
 join: 'Вступить в группу',
 dialog: 'Новый диалог',
 channel: 'Создать канал',
 'edit-channel': 'Настроить канал',
 'delete-channel': 'Удалить канал',
 'edit-group': 'Настройки группы',
 'group-stickers': 'Стикеры группы',
 invite: 'Пригласить участников',
 bots: 'Подключения'
};

export const modalTitle = (modal: string) => MODAL_TITLES[modal];

/** Тип канала по умолчанию: без права на текстовый создаётся голосовой. */
export const defaultChannelKind = (mode: string, canCreateText: boolean) =>
 mode === 'channel' && !canCreateText ? 'voice' : 'text';

export function toggleSelected(selected: readonly string[], id: string, checked: boolean, limit = SELECT_LIMIT) {
 if (!checked) return selected.filter(item => item !== id);
 if (selected.includes(id) || selected.length >= limit) return [...selected];
 return [...selected, id];
}

export const selectionFull = (selected: readonly string[], id: string, limit = SELECT_LIMIT) =>
 !selected.includes(id) && selected.length >= limit;

type DoneArgs = {
 mode: string;
 busy: boolean;
 name: string;
 selected: readonly string[];
 channelKind: string;
 editingChannelName: string | undefined;
 canCreateText: boolean;
 canCreateVoice: boolean;
};

/** Когда кнопка «Готово»/«Сохранить» в общем окне неактивна. */
export function modalDoneDisabled({
 mode,
 busy,
 name,
 selected,
 channelKind,
 editingChannelName,
 canCreateText,
 canCreateVoice
}: DoneArgs) {
 if (busy) return true;
 if (mode === 'channel') return !(channelKind === 'voice' ? canCreateVoice : canCreateText);
 if (mode === 'edit-channel') return !name.trim() || name.trim() === editingChannelName;
 if (mode === 'dialog') return !selected.length || selected.length > SELECT_LIMIT;
 return false;
}

/** Куда можно переслать сообщение: все переписки и все каналы всех групп. */
export function forwardDestinations(state: ChatState): ForwardDestination[] {
 return [
  ...state.dialogs.map(dialog => ({
   id: dialog.id,
   name: dialogName(state, dialog),
   keywords: state.users
    .filter(user => dialog.members.includes(user.id))
    .map(user => user.username || '')
    .join(' ')
  })),
  ...state.groups.flatMap(group =>
   group.channels.map(channel => ({
    id: channel.id,
    name: channel.name,
    group: {id: group.id, name: group.name},
    voice: channel.kind === 'voice'
   }))
  )
 ];
}

/** Звонок в открытой переписке: баннер и вход в звонок относятся только к домашнему режиму. */
export const dialogCallFor = (calls: readonly DialogCall[], home: boolean, channelId: string) =>
 home ? calls.find(item => item.dialog === channelId) : undefined;

export const voiceRoomOf = (home: boolean, call: DialogCall | undefined) => (home && call ? call.id : undefined);

/** Музыка играет только в голосовом канале группы: личный звонок её не знает. */
export function musicRoomOf(state: ChatState | null, room: string | undefined) {
 return state?.groups.some(group => group.channels.some(channel => channel.kind === 'voice' && channel.id === room))
  ? room
  : undefined;
}

/** Название комнаты в строке голосовой связи: канал группы, переписка звонка или «Личный звонок». */
export function callRoomName(state: ChatState | null, calls: readonly DialogCall[], room: string) {
 const channel = state?.groups.flatMap(group => group.channels).find(item => item.id === room);
 if (channel?.name) return channel.name;
 const dialog = calls.find(item => item.id === room)?.dialog;
 return state?.dialogs.find(item => item.id === dialog)?.name || 'Личный звонок';
}

/** Друзья ждут подтверждения: счётчик у пункта «Друзья». */
export const incomingFriendRequests = (state: ChatState | null) =>
 state ? state.friends.filter((friend: Friend) => !friend.accepted && friend.to === state.me.id).length : 0;

/** Временное сообщение оптимистичной отправки: префикс отличает его от серверного id. */
export const LOCAL_MESSAGE_PREFIX = 'local:';

export const localMessageId = (uuid: string) => `${LOCAL_MESSAGE_PREFIX}${uuid}`;

export const isLocalMessage = (id: string) => id.startsWith(LOCAL_MESSAGE_PREFIX);

/** Насколько время сервера может разойтись с часами клиента у того же сообщения. */
export const OUTGOING_MATCH_SECONDS = 120;

type MessageLike = {channel: string; user: string; text: string; time: number};

/** Одно и то же сообщение: канал, автор, текст и близкое время (а не точное совпадение часов). */
export function matchesServerMessage(draft: MessageLike, message: MessageLike) {
 if (draft.channel !== message.channel || draft.user !== message.user || draft.text !== message.text) return false;
 return Math.abs(message.time - draft.time) <= OUTGOING_MATCH_SECONDS;
}

/** Что показать в оптимистичном пузыре: текст черновика, а для файла без текста — имя файла. */
export const outgoingText = (text: string, attachmentName: string | undefined) => text.trim() || attachmentName || '';

/** Подсказка у значка «!»: понятный текст и, если сервер объяснил причину, сама причина. */
export const failedMessageHint = (error: string | undefined) =>
 `Не отправлено. Нажмите, чтобы повторить${error ? `. ${error}` : ''}`;
