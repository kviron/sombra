// Правила карточки сообщения: группировка, права, реакции, меню и время.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
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
} from './message-item-rules.ts';

const base = {id: 'm1', channel: 'c1', user: 'me', text: 'Привет', time: 1000};
const bot = {...base, id: 'm2', user: 'bot', bot_name: 'Бот'};

test('сообщения склеиваются, пока идут подряд без паузы', () => {
 assert.equal(isGrouped(undefined, base), false);
 assert.equal(isGrouped({...base, id: 'm0'}, base), true);
 assert.equal(isGrouped({...base, id: 'm0', time: 1000 - 301}, base), false, 'пауза больше пяти минут');
 assert.equal(isGrouped({...base, id: 'm0', channel: 'c2'}, base), false, 'другой канал');
 assert.equal(isGrouped({...base, id: 'm0', user: 'u2'}, base), false, 'другой автор');
 assert.equal(isGrouped({...base, id: 'm0', time: 1000 + 5}, base), false, 'время пошло назад');
 assert.equal(
  isGrouped(
   {...base, id: 'm0', time: new Date('2024-01-02T23:58:00').getTime() / 1000},
   {
    ...base,
    time: new Date('2024-01-03T00:01:00').getTime() / 1000
   }
  ),
  false,
  'разные дни'
 );
});

test('автор и право удалить для всех', () => {
 assert.equal(isAuthor(base, 'me'), true);
 assert.equal(isAuthor(base, 'u2'), false);
 assert.equal(isAuthor(bot, 'bot'), false, 'подпись бота отменяет авторство');
 assert.equal(canDeleteEveryone(true, false), true);
 assert.equal(canDeleteEveryone(false, true), true);
 assert.equal(canDeleteEveryone(false, false), false);
});

test('текст, картинка и имя автора определяются по сообщению', () => {
 assert.equal(hasText(base), true);
 assert.equal(hasText({...base, text: '   '}), false);
 assert.equal(isImageAttachment('image/png'), true);
 assert.equal(isImageAttachment('image/gif'), true);
 assert.equal(isImageAttachment('application/pdf'), false);
 assert.equal(isImageAttachment(undefined), false);
 assert.equal(authorName({id: 'me', name: 'Я', bio: '', created_at: 0}, base, 'Запасное'), 'Я');
 assert.equal(authorName({id: 'u', name: 'Аня', bio: '', created_at: 0}, bot, 'Запасное'), 'Аня');
 assert.equal(authorName(undefined, bot, 'Участник'), 'Бот');
 assert.equal(authorName(undefined, base, 'Участник'), 'Участник');
});

test('реакции считаются и отмечают мой голос', () => {
 const views = reactionViews(
  [
   {user: 'u1', emoji: '👍'},
   {user: 'me', emoji: '👍'},
   {user: 'u1', emoji: '🔥'}
  ],
  'me'
 );
 assert.deepEqual(views, [
  {emoji: '👍', count: 2, pressed: true},
  {emoji: '🔥', count: 1, pressed: false}
 ]);
 assert.deepEqual(reactionViews(undefined, 'me'), []);
});

test('галочка прочтения только для своего сообщения', () => {
 assert.equal(showsRead(true, true, 2), true);
 assert.equal(showsRead(true, true, 0), false);
 assert.equal(showsRead(undefined, true, 2), false);
 assert.equal(showsRead(true, false, 2), false);
 assert.match(readTitle({...base, readCount: 3}), /^Посмотрели: 3/);
 assert.match(readTitle({...base, readCount: 3, readAt: 1700000000}), /^Посмотрели: 3 · /);
});

test('меню действий собирается в порядке карточки', () => {
 const ids = args => messageMenu(args).map(item => item.id);
 const all = {
  hasReply: true,
  hasForward: true,
  hasText: true,
  author: true,
  forwarded: false,
  readSupported: true,
  read: true,
  readCount: 4
 };
 assert.deepEqual(ids(all), ['reply', 'forward', 'readers', 'edit', 'copy', 'delete']);
 assert.deepEqual(ids({...all, hasReply: false, hasForward: false, hasText: false, author: false}), ['delete']);
 assert.deepEqual(ids({...all, forwarded: true}), ['reply', 'forward', 'readers', 'copy', 'delete']);
 assert.equal(messageMenu({...all, read: false}).find(item => item.id === 'readers')?.label, 'Пока не просмотрено');
 assert.equal(messageMenu({...all, read: false}).find(item => item.id === 'readers')?.disabled, true);
 assert.equal(messageMenu(all).find(item => item.id === 'readers')?.label, 'Посмотрели: 4');
});

test('время сообщения форматируется как в разметке', () => {
 const time = Date.UTC(2024, 0, 2, 10, 30) / 1000;
 assert.match(messageTime(time), /^\d{2}:\d{2}$/);
 assert.equal(messageDateTime(time), '2024-01-02T10:30:00.000Z');
});
