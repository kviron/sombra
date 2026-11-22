// Правила доступа к инструментам бота: права, ответ сервера, черновик выбора и тексты.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
 canManageToolAccess,
 isToolPolicyConflict,
 normalizedUsers,
 toolAccessCandidates,
 toolAccessDirty,
 toolAccessDisabled,
 toolAccessFull,
 toolAccessHumans,
 toolAccessOwner,
 toolAccessSupported,
 toolAccessWithinLimit,
 toolInvalidSelection,
 toolLimitNotice,
 toolPolicyResponse,
 toggleToolUser
} from './bot-tool-access-rules.ts';

const me = {id: 'me', name: 'Я', bio: '', created_at: 0};
const bot = {id: 'b1', name: 'Бот', owner: 'me', transportVersion: 2};
const chat = {
 me,
 email: 'me@example.com',
 users: [
  me,
  {id: 'anya', name: 'Аня', username: 'anya', bio: '', created_at: 0},
  {id: 'petya', name: 'Пётр', bio: '', created_at: 0},
  {id: 'other-bot', name: 'Чужой бот', bio: '', created_at: 0, bot: true}
 ],
 groups: [],
 dialogs: [],
 messages: [],
 stickers: [],
 friends: [],
 bots: []
};

test('политика доступна владельцу бота, но не самому боту', () => {
 assert.equal(canManageToolAccess(chat, bot), true);
 assert.equal(canManageToolAccess({...chat, me: {...me, bot: true}}, bot), false);
 assert.equal(canManageToolAccess(chat, {...bot, owner: 'anya'}), false);
});

test('политика существует только на транспорте версии 2 и без привязки к каналу', () => {
 assert.equal(toolAccessSupported(bot), true);
 assert.equal(toolAccessSupported({...bot, transportVersion: 1}), false);
 assert.equal(toolAccessSupported({...bot, transportVersion: undefined}), false);
 assert.equal(toolAccessSupported({...bot, channel: 'c1'}), false);
});

test('ответ сервера проверяется и нормализуется до применения', () => {
 const policy = toolPolicyResponse({revision: 3, owner: 'me', users: ['anya', 'me', 'anya']});
 assert.deepEqual(policy.users, ['anya'], 'владелец и повторы убираются');
 assert.equal(policy.revision, 3);
 assert.throws(() => toolPolicyResponse({revision: -1, owner: 'me', users: []}), /Некорректный ответ/);
 assert.throws(() => toolPolicyResponse({revision: 1, owner: 7, users: []}), /Некорректный ответ/);
 assert.throws(() => toolPolicyResponse({revision: 1, owner: 'me', users: [1]}), /Некорректный ответ/);
 assert.throws(
  () => toolPolicyResponse({revision: 1, owner: 'me', users: Array.from({length: 51}, (_, index) => `u${index}`)}),
  /Некорректный ответ/
 );
});

test('отметка пользователя нормализуется, а предел не даёт добавить лишнего', () => {
 assert.deepEqual(toggleToolUser(['anya'], 'me', true), ['anya', 'me']);
 assert.deepEqual(toggleToolUser(['anya', 'me'], 'me', false), ['anya']);
 const full = Array.from({length: 50}, (_, index) => `u${index}`);
 assert.equal(toolAccessFull(full, 'me'), true);
 assert.equal(toolAccessFull(full, 'u0'), false, 'снять отметку можно всегда');
 assert.deepEqual(toggleToolUser(full, 'me', true), full, 'сверх предела черновик не растёт');
 assert.deepEqual(toggleToolUser(full, 'u0', false).length, 49);
 assert.equal(toolLimitNotice, 'Можно выбрать не более 50 пользователей.');
});

test('черновик сравнивается с политикой в одном порядке и с пределом сервера', () => {
 const policy = {revision: 1, owner: 'me', users: ['anya']};
 assert.equal(toolAccessDirty(policy, ['anya']), false);
 assert.equal(toolAccessDirty(policy, ['anya', 'me']), true);
 assert.equal(toolAccessDirty(undefined, ['anya']), false, 'без политики сохранять нечего');
 assert.equal(toolAccessWithinLimit(policy.users), true);
 assert.equal(toolAccessWithinLimit(Array.from({length: 51}, (_, index) => `u${index}`)), false);
});

test('кандидаты — люди Sombra, кроме владельца, с поиском по имени и ID', () => {
 const humans = toolAccessHumans(chat, bot);
 assert.deepEqual(
  humans.map(user => user.id),
  ['anya', 'petya'],
  'владелец и бот не предлагаются'
 );
 assert.deepEqual(
  toolAccessCandidates(chat, bot, 'аня').map(user => user.id),
  ['anya']
 );
 assert.deepEqual(
  toolAccessCandidates(chat, bot, 'PETYA').map(user => user.id),
  ['petya']
 );
 assert.deepEqual(toolAccessCandidates(chat, bot, 'петя'), []);
 assert.equal(toolAccessOwner(chat, {...bot, owner: 'anya'}).name, 'Аня');
 assert.equal(toolAccessOwner(chat, {...bot, owner: 'нет-такого'}).id, 'me', 'неизвестный владелец — это вы');
});

test('выбранные ID, которых больше нет среди людей, видны до сохранения', () => {
 const humans = toolAccessHumans(chat, bot);
 assert.deepEqual(toolInvalidSelection(['anya'], humans), []);
 assert.deepEqual(toolInvalidSelection(['anya', 'ушёл'], humans), ['ушёл']);
});

test('поле выбора неактивно при ожидании, занятости окна, смене владельца и без политики', () => {
 const policy = {revision: 1, owner: 'me', users: []};
 assert.equal(toolAccessDisabled({pending: false, rootBusy: false, blocked: false, policy}), false);
 assert.equal(toolAccessDisabled({pending: true, rootBusy: false, blocked: false, policy}), true);
 assert.equal(toolAccessDisabled({pending: false, rootBusy: true, blocked: false, policy}), true);
 assert.equal(toolAccessDisabled({pending: false, rootBusy: false, blocked: true, policy}), true);
 assert.equal(toolAccessDisabled({pending: false, rootBusy: false, blocked: false, policy: undefined}), true);
});

test('конфликт ревизии распознаётся в тексте ошибки сервера', () => {
 assert.equal(isToolPolicyConflict('CONFLICT: revision is stale'), true);
 assert.equal(isToolPolicyConflict('Политика устарела'), true);
 assert.equal(isToolPolicyConflict('Нет доступа'), false);
 assert.equal(normalizedUsers(['b', 'a', 'b']).join(','), 'a,b');
});
