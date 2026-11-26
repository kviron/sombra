// Правила страницы чата: какая переписка показана, порядок сообщений, права и тексты статусов.
// Тест читает только чистые функции: сети, DOM и React в chat-rules.ts нет.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
 SELECT_LIMIT,
 callRoomName,
 canEditGroup,
 canRequestFriend,
 channelFor,
 chatTitle,
 conversationEmptyText,
 currentGroup,
 dayLabel,
 defaultChannelKind,
 dialogCallFor,
 dialogEmptyText,
 dialogList,
 failedMessageHint,
 isLocalMessage,
 localMessageId,
 dialogName,
 dialogPeer,
 dmPeerFor,
 filterMessages,
 forwardDestinations,
 friendStatus,
 friendsOpen,
 groupInviteCandidates,
 humanTypingEnabled,
 incomingFriendRequests,
 isVoiceChannel,
 isVoiceView,
 latestMessages,
 matchesServerMessage,
 memberName,
 modalDoneDisabled,
 modalTitle,
 musicRoomOf,
 OUTGOING_MATCH_SECONDS,
 outgoingText,
 onlineText,
 ownerDmBot,
 peerTypingUntil,
 preferencesForDialog,
 readsBlocked,
 referencesSupported,
 scrollRevision,
 selectionFull,
 sendDisabled,
 startsDay,
 toggleSelected,
 unreadBadge,
 unreadLabel,
 voiceRoomOf
} from './chat-rules.ts';

const me = {id: 'me', name: 'Я', bio: '', created_at: 0, online: true};
const friendUser = {id: 'u2', name: 'Друг', username: 'friend', bio: '', created_at: 0};
const botUser = {id: 'b1', name: 'Бот', username: 'bot', bio: '', created_at: 0, bot: true};

test('приглашение предлагает только людей вне текущей группы', () => {
 assert.deepEqual(groupInviteCandidates([me, friendUser, botUser], [me.id]), [friendUser]);
 assert.deepEqual(groupInviteCandidates([me, friendUser, botUser], [me.id, friendUser.id]), []);
});
const dialog = {id: 'd1', name: 'Сохранённое имя', members: ['me', 'u2'], revision: 1};
const groupDialog = {id: 'd2', name: 'Команда', members: ['me', 'u2', 'b1']};
const gameChannel = {id: 'c2', name: 'games', kind: 'text'};
const voiceChannel = {id: 'v1', name: 'Музыка', kind: 'voice'};
const group = {
 id: 'g1',
 name: 'Группа',
 owner: 'me',
 invite: 'code',
 members: ['me', 'u2'],
 channels: [{id: 'c1', name: 'general', kind: 'text'}, gameChannel, voiceChannel]
};
const messages = [
 {id: 'm1', channel: 'd1', user: 'u2', text: 'Привет', time: 1_700_000_000},
 {id: 'm2', channel: 'd1', user: 'me', text: 'Ответ', time: 1_700_000_100},
 {id: 'm3', channel: 'c1', user: 'me', text: 'В канале', time: 1_700_000_200}
];
const friend = {id: 'f1', from: 'u2', to: 'me', accepted: false};
const acceptedFriend = {id: 'f2', from: 'me', to: 'u2', accepted: true};
const state = {
 me,
 email: 'me@sombra',
 users: [me, friendUser, botUser],
 groups: [group],
 dialogs: [dialog, groupDialog],
 messages,
 stickers: [],
 friends: [friend, acceptedFriend],
 bots: [{id: 'b1', name: 'Бот', owner: 'me', username: 'bot'}],
 features: {messageReferences: true},
 humanTypingSupported: true,
 chatPreferences: {
  notifications: {direct: true, groups: true},
  dialogs: {d1: {pinned: true, muted: false}, d2: {pinned: false, muted: true}}
 }
};

test('группа и канал выбираются по id, а если выбора нет — первая группа и её канал', () => {
 assert.equal(currentGroup(state, 'g1')?.id, 'g1');
 assert.equal(currentGroup(state, 'нет')?.id, 'g1');
 assert.equal(currentGroup({...state, groups: []}, 'g1'), undefined);
 assert.equal(currentGroup(null, 'g1'), undefined);
 assert.equal(channelFor({home: true, state, group: undefined, channelId: 'd1'})?.id, 'd1');
 assert.equal(channelFor({home: true, state, group: undefined, channelId: 'нет'}), undefined);
 assert.equal(channelFor({home: false, state, group, channelId: 'c1'})?.id, 'c1');
 assert.equal(channelFor({home: false, state, group, channelId: 'нет'})?.id, 'c2', 'запасной канал games');
 assert.equal(channelFor({home: false, state, group: {id: 'g', channels: []}, channelId: ''}), undefined);
});

test('имя переписки — имя собеседника, у групповой — сохранённое название', () => {
 assert.equal(dialogName(state, dialog), 'Друг');
 assert.equal(dialogName(state, groupDialog), 'Команда');
 assert.equal(dialogName(state, {id: 'd3', name: 'Пустой', members: ['me', 'нет']}), 'Пустой');
 assert.equal(dialogName(null, dialog), 'Сохранённое имя');
 assert.equal(dialogPeer(state, dialog)?.id, 'u2');
 assert.equal(dialogPeer(null, dialog), undefined);
});

test('заголовок шапки: друзья, переписка, канал и пустые состояния', () => {
 assert.equal(chatTitle({home: true, state, channel: dialog, group: undefined, friends: true}), 'Друзья');
 assert.equal(chatTitle({home: true, state, channel: dialog, group: undefined, friends: false}), 'Друг');
 assert.equal(chatTitle({home: false, state, channel: gameChannel, group, friends: false}), 'games');
 assert.equal(
  chatTitle({home: true, state, channel: undefined, group: undefined, friends: false}),
  'Выберите переписку'
 );
 assert.equal(chatTitle({home: false, state, channel: undefined, group, friends: false}), 'Выберите канал');
 assert.equal(chatTitle({home: false, state, channel: undefined, group: undefined, friends: false}), 'Выберите группу');
 assert.equal(friendsOpen(true, 'friends'), true);
 assert.equal(friendsOpen(false, 'friends'), false);
});

test('собеседник шапки и бот владельца определяются только в домашнем режиме', () => {
 assert.equal(dmPeerFor({home: true, state, channel: dialog})?.id, 'u2');
 assert.equal(dmPeerFor({home: false, state, channel: dialog}), undefined);
 assert.equal(dmPeerFor({home: true, state, channel: groupDialog}), undefined);
 assert.equal(dmPeerFor({home: true, state, channel: gameChannel}), undefined);
 assert.equal(ownerDmBot(state, friendUser), undefined, 'у человека нет бота');
 assert.equal(ownerDmBot(state, botUser)?.id, 'b1');
 assert.equal(ownerDmBot({...state, me: {...me, bot: true}}, botUser), undefined);
 assert.equal(ownerDmBot(null, botUser), undefined);
});

test('последнее сообщение канала и порядок переписок: закреплённые, затем свежие', () => {
 const latest = latestMessages(state.messages);
 assert.equal(latest.get('d1')?.id, 'm2');
 assert.equal(latest.get('c1')?.id, 'm3');
 const {dialogs} = dialogList({state, search: ''});
 assert.deepEqual(
  dialogs.map(item => item.id),
  ['d1', 'd2'],
  'закреплённая переписка идёт первой'
 );
 const filtered = dialogList({state, search: 'команд'});
 assert.deepEqual(
  filtered.dialogs.map(item => item.id),
  ['d2']
 );
 assert.deepEqual(dialogList({state: null, search: ''}).dialogs, []);
});

test('предпочтения переписки и счётчик непрочитанного', () => {
 assert.deepEqual(preferencesForDialog(state.chatPreferences, 'd1'), {pinned: true, muted: false});
 assert.deepEqual(preferencesForDialog(state.chatPreferences, 'd2'), {pinned: false, muted: true});
 assert.deepEqual(preferencesForDialog(undefined, 'd1'), {pinned: false, muted: false});
 assert.equal(unreadBadge(5), 5);
 assert.equal(unreadBadge(120), '99+');
 assert.equal(unreadLabel(7), 'Непрочитанных сообщений: 7');
 assert.equal(onlineText(true), 'В сети');
 assert.equal(onlineText(false), 'Не в сети');
});

test('пустой список переписок и пустой транскрипт объясняются словами', () => {
 assert.equal(dialogEmptyText({search: 'дру', ready: true}), 'Переписки не найдены');
 assert.match(dialogEmptyText({search: '', ready: true}), /Нажмите \+/);
 assert.match(dialogEmptyText({search: '', ready: false}), /Загрузка/);
 assert.match(conversationEmptyText(true), /Начните разговор/);
 assert.match(conversationEmptyText(false), /Выберите или создайте комнату/);
});

test('поиск по сообщениям учитывает текст и автора', () => {
 const users = state.users;
 assert.equal(filterMessages({messages, search: '', users}).length, 3);
 assert.deepEqual(
  filterMessages({messages, search: 'привет', users}).map(item => item.id),
  ['m1']
 );
 assert.deepEqual(
  filterMessages({messages, search: 'друг', users}).map(item => item.id),
  ['m1']
 );
 assert.equal(memberName(users, 'u2'), 'Друг');
 assert.equal(memberName(users, 'нет'), 'Участник');
});

test('разделитель даты ставится перед первым сообщением и на смене дня', () => {
 assert.equal(startsDay(messages, 0), true);
 assert.equal(startsDay(messages, 1), false);
 const nextDay = [...messages, {id: 'm4', channel: 'd1', user: 'me', text: 'Утро', time: 1_700_100_000}];
 assert.equal(startsDay(nextDay, 3), true);
 assert.match(dayLabel(messages[0].time), /\d/u);
 assert.equal(scrollRevision(['a', 'b'], false), '2:b:false');
 assert.equal(scrollRevision([], true), '0::true');
});

test('отправка недоступна без текста и вложения, во время чтения и при занятости', () => {
 const base = {busy: false, reading: false, hasChannel: true, draft: 'текст', attachment: false};
 assert.equal(sendDisabled(base), false);
 assert.equal(sendDisabled({...base, draft: '   '}), true);
 assert.equal(sendDisabled({...base, draft: '', attachment: true}), false);
 assert.equal(sendDisabled({...base, reading: true}), true);
 assert.equal(sendDisabled({...base, busy: true}), true);
 assert.equal(sendDisabled({...base, hasChannel: false}), true);
});

test('сигнал «печатает…» выключен у ботов, в открытых окнах и без поддержки сервера', () => {
 const base = {
  state,
  peer: friendUser,
  busy: false,
  settings: false,
  modal: false,
  profile: false,
  info: false,
  botSettings: false,
  roles: false
 };
 assert.equal(humanTypingEnabled(base), true);
 assert.equal(humanTypingEnabled({...base, peer: botUser}), false);
 assert.equal(humanTypingEnabled({...base, peer: undefined}), false);
 assert.equal(humanTypingEnabled({...base, modal: true}), false);
 assert.equal(humanTypingEnabled({...base, roles: true}), false);
 assert.equal(humanTypingEnabled({...base, state: {...state, humanTypingSupported: false}}), false);
 assert.equal(humanTypingEnabled({...base, state: null}), false);
});

test('отметка прочтения перекрывается любым открытым окном, но не черновиком', () => {
 const base = {
  settings: false,
  modal: false,
  profile: false,
  headerProfile: false,
  info: false,
  roles: false,
  managedBot: false,
  incoming: false,
  friends: false,
  picker: false
 };
 assert.equal(readsBlocked(base), false);
 assert.equal(readsBlocked({...base, settings: true}), true);
 assert.equal(readsBlocked({...base, incoming: true}), true);
 assert.equal(readsBlocked({...base, friends: true}), true);
 assert.equal(readsBlocked({...base, picker: true}), true);
});

test('статус дружбы и право отправить заявку', () => {
 assert.equal(friendStatus(state, 'me'), 'self');
 assert.equal(friendStatus({...state, friends: [acceptedFriend]}, 'u2'), 'friends');
 assert.equal(friendStatus({...state, friends: [friend]}, 'u2'), 'incoming');
 assert.equal(friendStatus({...state, friends: [{id: 'f3', from: 'me', to: 'u2', accepted: false}]}, 'u2'), 'outgoing');
 assert.equal(friendStatus({...state, friends: []}, 'u2'), 'none');
 assert.equal(friendStatus(null, 'u2'), 'none');
 assert.equal(canRequestFriend({...state, friends: []}, 'u2'), true);
 assert.equal(canRequestFriend(state, 'u2'), false);
 assert.equal(canRequestFriend(state, 'me'), false);
 assert.equal(incomingFriendRequests({...state, friends: [friend]}), 1);
 assert.equal(incomingFriendRequests(null), 0);
});

test('сведения о сообщении в шапке и права группы', () => {
 assert.equal(canEditGroup(state, group), true);
 assert.equal(canEditGroup(state, {...group, members: ['u2']}), false);
 assert.equal(canEditGroup(null, group), false);
 assert.equal(canEditGroup(state, undefined), false);
 assert.equal(referencesSupported(state), true);
 assert.equal(referencesSupported({...state, features: {}}), false);
 assert.equal(referencesSupported(null), false);
});

test('общее окно действий: заголовки, тип канала и правила готовности', () => {
 assert.equal(modalTitle('channel'), 'Создать канал');
 assert.equal(modalTitle('delete-channel'), 'Удалить канал');
 assert.equal(modalTitle('неизвестно'), undefined);
 assert.equal(defaultChannelKind('channel', true), 'text');
 assert.equal(defaultChannelKind('channel', false), 'voice');
 assert.equal(defaultChannelKind('group', false), 'text');
 const base = {
  mode: 'group',
  busy: false,
  name: 'Название',
  selected: [],
  channelKind: 'text',
  editingChannelName: undefined,
  canCreateText: true,
  canCreateVoice: true
 };
 assert.equal(modalDoneDisabled(base), false);
 assert.equal(modalDoneDisabled({...base, busy: true}), true);
 assert.equal(modalDoneDisabled({...base, mode: 'channel', channelKind: 'voice', canCreateVoice: false}), true);
 assert.equal(modalDoneDisabled({...base, mode: 'dialog'}), true);
 assert.equal(modalDoneDisabled({...base, mode: 'dialog', selected: ['u2']}), false);
 assert.equal(modalDoneDisabled({...base, mode: 'edit-channel', editingChannelName: 'Название'}), true);
 assert.equal(modalDoneDisabled({...base, mode: 'edit-channel', editingChannelName: 'Другое'}), false);
});

test('выбранные участники нового диалога ограничены девятью', () => {
 assert.equal(SELECT_LIMIT, 9);
 assert.deepEqual(toggleSelected([], 'u1', true), ['u1']);
 assert.deepEqual(toggleSelected(['u1', 'u2'], 'u1', false), ['u2']);
 assert.deepEqual(toggleSelected(['u1'], 'u1', true), ['u1'], 'повтор не дублируется');
 const full = Array.from({length: SELECT_LIMIT}, (_, index) => `u${index}`);
 assert.equal(toggleSelected(full, 'new', true).length, SELECT_LIMIT);
 assert.equal(selectionFull(full, 'new'), true);
 assert.equal(selectionFull(full, 'u0'), false);
});

test('назначения пересылки: переписки и каналы групп', () => {
 const destinations = forwardDestinations({...state, dialogs: [dialog, {...groupDialog, avatar: 'group-avatar'}]});
 assert.deepEqual(
  destinations.map(item => item.id),
  ['d1', 'd2', 'c1', 'c2', 'v1']
 );
 assert.equal(destinations[0].name, 'Друг');
 assert.equal(destinations[0].peer, friendUser);
 assert.equal(destinations[1].peer, undefined);
 assert.equal(destinations[1].avatar, 'group-avatar');
 assert.equal(destinations[0].keywords, ' friend', 'псевдонимы участников через пробел');
 assert.deepEqual(destinations[3].group, {id: 'g1', name: 'Группа'});
 assert.equal(destinations[4].voice, true);
 assert.equal(destinations[2].voice, false);
});

test('звонок в переписке и название комнаты в строке голосовой связи', () => {
 const calls = [
  {id: 'call1', dialog: 'd1', caller: 'u2', video: false, created_at: 1, participants: [], declined: []},
  {id: 'call2', dialog: 'd2', caller: 'u2', video: true, created_at: 2, participants: [], declined: []}
 ];
 assert.equal(dialogCallFor(calls, true, 'd1')?.id, 'call1');
 assert.equal(dialogCallFor(calls, false, 'd1'), undefined);
 assert.equal(dialogCallFor(calls, true, 'нет'), undefined);
 assert.equal(voiceRoomOf(true, calls[0]), 'call1');
 assert.equal(voiceRoomOf(false, calls[0]), undefined);
 assert.equal(callRoomName(state, calls, 'v1'), 'Музыка');
 assert.equal(callRoomName(state, calls, 'call2'), 'Команда', 'название переписки звонка');
 assert.equal(callRoomName(state, calls, 'чужой'), 'Личный звонок');
 assert.equal(musicRoomOf(state, 'v1'), 'v1');
 assert.equal(musicRoomOf(state, 'd1'), undefined);
});

test('голосовой расклад и типы каналов', () => {
 assert.equal(isVoiceChannel(voiceChannel), true);
 assert.equal(isVoiceChannel(gameChannel), false);
 assert.equal(isVoiceChannel(undefined), false);
 assert.equal(isVoiceView({channel: voiceChannel, voiceRoom: undefined, room: undefined}), true);
 assert.equal(isVoiceView({channel: gameChannel, voiceRoom: 'v1', room: 'v1'}), true);
 assert.equal(isVoiceView({channel: gameChannel, voiceRoom: 'v1', room: 'c1'}), false);
 assert.equal(isVoiceView({channel: undefined, voiceRoom: undefined, room: undefined}), false);
});

test('до какого времени показывать «печатает…»', () => {
 const typingState = {
  ...state,
  humanTyping: [
   {user: 'u2', channel: 'd1', until: 500},
   {user: 'u2', channel: 'd1', until: 900},
   {user: 'u2', channel: 'c1', until: 5000}
  ],
  botTyping: [{bot: 'b1', channel: 'd1', until: 700}]
 };
 assert.equal(peerTypingUntil(typingState, friendUser, 'd1'), 900);
 assert.equal(peerTypingUntil(typingState, botUser, 'd1'), 700);
 assert.equal(peerTypingUntil(typingState, friendUser, 'd2'), 0);
 assert.equal(peerTypingUntil(typingState, undefined, 'd1'), 0);
 assert.equal(peerTypingUntil(null, friendUser, 'd1'), 0);
});

test('временный id оптимистичного сообщения отличим от серверного', () => {
 const id = localMessageId('3f0c1d9e-0000-4000-8000-000000000000');
 assert.equal(id, 'local:3f0c1d9e-0000-4000-8000-000000000000');
 assert.equal(isLocalMessage(id), true);
 assert.equal(isLocalMessage('m1'), false);
 assert.equal(isLocalMessage(''), false);
});

test('серверное сообщение склеивается с черновиком по каналу, автору, тексту и близкому времени', () => {
 const draft = {channel: 'd1', user: 'me', text: 'Привет', time: 1_700_000_000};
 assert.equal(matchesServerMessage(draft, {...draft, time: 1_700_000_030}), true, 'часы разошлись на 30 секунд');
 assert.equal(matchesServerMessage(draft, {...draft, time: 1_700_000_000 + OUTGOING_MATCH_SECONDS}), true);
 assert.equal(matchesServerMessage(draft, {...draft, time: 1_700_000_000 + OUTGOING_MATCH_SECONDS + 1}), false);
 assert.equal(matchesServerMessage(draft, {...draft, text: 'Привет!'}), false, 'другой текст — другое сообщение');
 assert.equal(matchesServerMessage(draft, {...draft, channel: 'c1'}), false);
 assert.equal(matchesServerMessage(draft, {...draft, user: 'u2'}), false);
});

test('одинаковые сообщения одного автора не считаются дубликатами, если время далеко', () => {
 const first = {channel: 'd1', user: 'me', text: 'ок', time: 1_700_000_000};
 const second = {channel: 'd1', user: 'me', text: 'ок', time: 1_700_000_500};
 assert.equal(matchesServerMessage(first, second), false, 'два разных «ок» через восемь минут');
 assert.equal(matchesServerMessage(first, {...first, time: first.time + 1}), true);
});

test('в оптимистичном пузыре текст черновика, а без текста — имя файла', () => {
 assert.equal(outgoingText('  Привет  ', 'photo.png'), 'Привет', 'сервер хранит обрезанный текст');
 assert.equal(outgoingText('   ', 'photo.png'), 'photo.png');
 assert.equal(outgoingText('', undefined), '');
 assert.equal(outgoingText('', 'file.pdf'), 'file.pdf');
});

test('подсказка у значка «!» объясняет, что делать, и повторяет причину', () => {
 assert.equal(failedMessageHint(undefined), 'Не отправлено. Нажмите, чтобы повторить');
 assert.equal(failedMessageHint('Нет соединения'), 'Не отправлено. Нажмите, чтобы повторить. Нет соединения');
 assert.equal(failedMessageHint(''), 'Не отправлено. Нажмите, чтобы повторить');
});
