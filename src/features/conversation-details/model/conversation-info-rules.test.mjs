// Правила информации о чате: права на правку, поиск участников, готовность к сохранению.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
 canEditDialog,
 canSaveDialog,
 matchesMember,
 memberSearchHint,
 visibleMemberIds
} from './conversation-info-rules.ts';

const dialog = {
 id: 'd1',
 name: 'Команда',
 members: ['me', 'a', 'b'],
 channels: [],
 owner: 'me',
 avatar: '',
 revision: 3
};

const chat = {
 me: {id: 'me', name: 'Я', bio: '', created_at: 0},
 email: 'me@example.com',
 users: [
  {id: 'me', name: 'Я', bio: '', created_at: 0},
  {id: 'a', name: 'Аня', username: 'anya', bio: '', created_at: 0},
  {id: 'b', name: 'Бот', bio: '', created_at: 0, bot: true}
 ],
 groups: [],
 dialogs: [],
 messages: [],
 stickers: [],
 friends: [],
 bots: [],
 dialogMetadataSupported: true,
 conversationMemberSearchSupported: true
};

test('владелец группы может править чат, пока в нём нет ботов', () => {
 assert.equal(canEditDialog(chat, dialog), false, 'бот в участниках запрещает правку');
 assert.equal(
  canEditDialog(chat, {...dialog, members: ['me', 'a', 'c']}),
  false,
  'незнакомый участник запрещает правку'
 );
 assert.equal(canEditDialog(chat, {...dialog, owner: 'a'}), false, 'правит только владелец');
});

test('правка требует серверной поддержки метаданных', () => {
 assert.equal(canEditDialog({...chat, dialogMetadataSupported: false}, dialog), false);
});

test('поиск по имени и логину идёт по известным участникам', () => {
 assert.equal(matchesMember(chat.users[1], 'аня'), true);
 assert.equal(matchesMember(chat.users[1], '@anya'), true);
 assert.equal(matchesMember(chat.users[1], 'петя'), false);
});

test('без запроса показываются все участники', () => {
 const shown = visibleMemberIds({chat, channel: 'c1', memberIds: dialog.members, query: '', remote: undefined});
 assert.deepEqual(shown, ['me', 'a', 'b']);
});

test('по email показывается ответ сервера только для текущего ключа', () => {
 const remote = {key: 'me:c1:a@b.c:me,a,b', users: [chat.users[1]]};
 const shown = visibleMemberIds({chat, channel: 'c1', memberIds: dialog.members, query: 'a@b.c', remote});
 assert.deepEqual(shown, ['a']);
 const stale = visibleMemberIds({
  chat,
  channel: 'c1',
  memberIds: dialog.members,
  query: 'a@b.c',
  remote: {...remote, key: 'другой'}
 });
 assert.deepEqual(stale, []);
});

test('подсказка под поиском отражает состояние запроса', () => {
 assert.equal(
  memberSearchHint({query: '', supported: true, pending: false, remote: undefined, shown: 3}),
  'Поиск только среди участников этого чата. Email не отображается.'
 );
 assert.equal(
  memberSearchHint({query: 'a@b.c', supported: false, pending: false, remote: undefined, shown: 0}),
  'Поиск по email недоступен на этой версии сервера. Используйте имя или логин.'
 );
 assert.equal(
  memberSearchHint({query: 'аня', supported: true, pending: false, remote: undefined, shown: 0}),
  'Участники не найдены'
 );
 assert.equal(
  memberSearchHint({query: 'аня', supported: true, pending: false, remote: undefined, shown: 2}),
  'Найдено: 2'
 );
});

test('сохранить можно только изменённый черновик', () => {
 assert.equal(canSaveDialog('Команда', '', dialog), false, 'ничего не изменилось');
 assert.equal(canSaveDialog('  ', '', dialog), false, 'пустое имя');
 assert.equal(canSaveDialog('Новое', '', dialog), true);
 assert.equal(canSaveDialog('Команда', 'data:image/png;base64,x', dialog), true, 'сменился аватар');
});
