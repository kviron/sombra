// Правила списка друзей: вкладки, поиск, подписи строк и пустое состояние.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
 canAcceptFriend,
 friendNote,
 friendOf,
 friendRowKind,
 friendTabUsers,
 friendsCountLabel,
 friendsEmptyText,
 friendTabs,
 incomingFriendRequests,
 matchesFriendName
} from './chat-friends-rules.ts';

const me = {id: 'me', name: 'Я', bio: '', created_at: 0};
const users = [
 me,
 {id: 'anya', name: 'Аня', bio: 'Дизайнер', created_at: 0},
 {id: 'petya', name: 'Пётр', bio: '', created_at: 0},
 {id: 'sonya', name: 'Соня', bio: '', created_at: 0},
 {id: 'bot', name: 'Бот', bio: '', created_at: 0, bot: true}
];
const friends = [
 {id: 'f1', from: 'me', to: 'anya', accepted: true},
 {id: 'f2', from: 'me', to: 'petya', accepted: false},
 {id: 'f3', from: 'sonya', to: 'me', accepted: false}
];

test('запись о дружбе находится в обоих направлениях', () => {
 assert.equal(friendOf(friends, 'me', 'anya')?.id, 'f1');
 assert.equal(friendOf(friends, 'me', 'sonya')?.id, 'f3');
 assert.equal(friendOf(friends, 'me', 'нет-такого'), undefined);
});

test('вкладки показывают друзей, заявки или незнакомых людей без себя и ботов', () => {
 const base = {users, friends, me: 'me', query: ''};
 assert.deepEqual(
  friendTabUsers({...base, tab: 'all'}).map(user => user.id),
  ['anya']
 );
 assert.deepEqual(
  friendTabUsers({...base, tab: 'pending'}).map(user => user.id),
  ['petya', 'sonya']
 );
 assert.deepEqual(
  friendTabUsers({...base, tab: 'add'}).map(user => user.id),
  [],
  'все люди уже знакомы'
 );
 assert.deepEqual(
  friendTabUsers({...base, tab: 'add', friends: []}).map(user => user.id),
  ['anya', 'petya', 'sonya']
 );
});

test('поиск по имени без учёта регистра, пустой запрос показывает всех', () => {
 assert.equal(matchesFriendName(users[1], 'АНЯ'), true);
 assert.equal(matchesFriendName(users[1], 'пет'), false);
 assert.deepEqual(
  friendTabUsers({users, friends: [], me: 'me', tab: 'add', query: 'пё'}).map(user => user.id),
  ['petya']
 );
 assert.equal(friendTabUsers({users, friends: [], me: 'me', tab: 'add', query: ''}).length, 3);
});

test('подпись строки: направление заявки важнее описания профиля', () => {
 assert.equal(friendNote(friends[0], 'me', 'Дизайнер'), 'Дизайнер', 'у друзей видно описание');
 assert.equal(friendNote(friends[0], 'me', ''), 'Пользователь Sombra');
 assert.equal(friendNote(friends[1], 'me', 'Дизайнер'), 'Заявка отправлена');
 assert.equal(friendNote(friends[2], 'me', 'Дизайнер'), 'Хочет добавить вас в друзья');
 assert.equal(friendNote(undefined, 'me', 'Дизайнер'), 'Дизайнер');
});

test('вид строки и право принять входящую заявку', () => {
 assert.equal(friendRowKind(undefined), 'add');
 assert.equal(friendRowKind(friends[0]), 'friend');
 assert.equal(friendRowKind(friends[1]), 'request');
 assert.equal(canAcceptFriend(friends[2], 'me'), true);
 assert.equal(canAcceptFriend(friends[1], 'me'), false, 'исходящую не принимают');
 assert.equal(canAcceptFriend(friends[0], 'me'), false, 'дружба уже принята');
 assert.equal(canAcceptFriend(undefined, 'me'), false);
});

test('счётчик заявок считает только входящие, которые ждут ответа', () => {
 assert.equal(incomingFriendRequests(friends, 'me'), 1);
 assert.equal(incomingFriendRequests([], 'me'), 0);
 assert.equal(incomingFriendRequests([{id: 'f4', from: 'anya', to: 'me', accepted: false}], 'me'), 1);
 assert.equal(friendsCountLabel('all'), 'Ваши друзья');
 assert.equal(friendsCountLabel('pending'), 'Ожидают ответа');
 assert.equal(friendsCountLabel('add'), 'Люди в Sombra');
});

test('пустое состояние объясняет вкладку и предлагает добавить друга только в «Все друзья»', () => {
 assert.deepEqual(friendsEmptyText('all'), {
  title: 'Здесь будут ваши друзья',
  note: 'Добавьте знакомых, чтобы быстро начинать разговор.',
  add: true
 });
 assert.equal(friendsEmptyText('pending').title, 'Новых заявок пока нет');
 assert.equal(friendsEmptyText('pending').add, false);
 assert.equal(friendsEmptyText('add').title, 'Никого не нашли');
 assert.equal(friendsEmptyText('add').note, 'Попробуйте поискать по имени или загляните позже.');
 assert.deepEqual(
  friendTabs.map(item => item.label),
  ['Все друзья', 'Заявки', 'Добавить друга']
 );
});
