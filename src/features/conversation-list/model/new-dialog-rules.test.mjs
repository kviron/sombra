// Правила нового чата: кандидаты, поиск, лимит выбора и текст кнопки создания.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
 NEW_DIALOG_MEMBER_LIMIT,
 canSubmitSelection,
 commonMemberIds,
 dialogPeople,
 emptyPeopleText,
 errorText,
 friendIds,
 limitNote,
 memberUnavailable,
 newDialogPayload,
 selectedPeople,
 submitLabel,
 toggleSelected,
 visiblePeople
} from './new-dialog-rules.ts';

const me = {id: 'me', name: 'Я', bio: '', created_at: 0};
const anya = {id: 'a', name: 'Аня', username: 'anya', bio: '', created_at: 0};
const boris = {id: 'b', name: 'Борис', bio: '', created_at: 0};
const bot = {id: 'bot', name: 'Бот', bio: '', created_at: 0, bot: true};
const friend = {id: 'f', from: 'me', to: 'a', accepted: true};

const chat = {
 me,
 email: 'me@example.com',
 users: [me, anya, boris, bot],
 groups: [
  {id: 'g1', name: 'Группа', owner: 'me', invite: 'x', members: ['me', 'b'], channels: []},
  {id: 'g2', name: 'Чужая', owner: 'b', invite: 'y', members: ['b'], channels: []}
 ],
 dialogs: [],
 messages: [],
 stickers: [],
 friends: [friend],
 bots: []
};

test('друзья определяются по подтверждённой дружбе в обе стороны', () => {
 assert.deepEqual([...friendIds(chat)], ['a']);
 assert.deepEqual([...friendIds({...chat, friends: [{...friend, accepted: false}]})], []);
 assert.deepEqual([...friendIds({...chat, friends: [{id: 'x', from: 'a', to: 'me', accepted: true}]})], ['a']);
});

test('кандидаты — друзья и участники общих групп без себя и дублей', () => {
 assert.deepEqual([...commonMemberIds(chat)].sort(), ['b', 'me']);
 assert.deepEqual(
  dialogPeople(
   {...chat, users: [...chat.users, {...boris, name: 'Борис второй'}]},
   friendIds(chat),
   commonMemberIds(chat)
  ).map(user => user.id),
  ['a', 'b']
 );
 assert.equal(
  dialogPeople(chat, friendIds(chat), commonMemberIds(chat)).some(user => user.id === 'me'),
  false
 );
});

test('поиск по имени идёт по кандидатам, друзья — первыми', () => {
 const people = dialogPeople(chat, friendIds(chat), commonMemberIds(chat));
 assert.deepEqual(
  visiblePeople(people, friendIds(chat), '').map(user => user.id),
  ['a', 'b']
 );
 assert.deepEqual(
  visiblePeople([...people].reverse(), friendIds(chat), 'бор').map(user => user.id),
  ['b']
 );
 assert.deepEqual(visiblePeople(people, friendIds(chat), 'петя'), []);
});

test('выбор уважает лимит десятерых вместе с вами', () => {
 const nine = Array.from({length: NEW_DIALOG_MEMBER_LIMIT}, (_, index) => `u${index}`);
 assert.deepEqual(toggleSelected(nine, 'ещё'), nine, 'десятый человек не добавляется');
 assert.deepEqual(toggleSelected([], 'a'), ['a']);
 assert.deepEqual(toggleSelected(['a', 'b'], 'a'), ['b']);
 assert.equal(canSubmitSelection([]), false);
 assert.equal(canSubmitSelection(['a']), true);
});

test('недоступность строки учитывает лимит, ботов и блокировку', () => {
 const chosenBot = selectedPeople(chat.users, ['bot']);
 const nine = Array.from({length: NEW_DIALOG_MEMBER_LIMIT}, (_, index) => `u${index}`);
 assert.equal(memberUnavailable(bot, [], [], false), false, 'бота одного выбрать можно');
 assert.equal(memberUnavailable(anya, ['bot'], chosenBot, false), true, 'с ботом люди не выбираются');
 assert.equal(memberUnavailable(bot, ['a'], [anya], false), true, 'бота вторым не выбрать');
 assert.equal(memberUnavailable(anya, nine, [], false), true, 'после девяти выбор закрыт');
 assert.equal(memberUnavailable(anya, [], [], true), true, 'во время создания строки заблокированы');
});

test('имя группы берётся из поля или из имён выбранных, личный диалог — без имени', () => {
 assert.deepEqual(newDialogPayload(['a'], [anya], 'Любое'), {members: ['a']});
 assert.deepEqual(newDialogPayload(['a', 'b'], [anya, boris], ' Команда '), {
  members: ['a', 'b'],
  name: 'Команда'
 });
 assert.deepEqual(newDialogPayload(['a', 'b'], [anya, boris], ''), {members: ['a', 'b'], name: 'Аня, Борис'});
});

test('подписи кнопки и подсказок зависят от состояния операции', () => {
 assert.equal(submitLabel({busy: true, created: false, error: '', count: 1}), 'Создаём…');
 assert.equal(submitLabel({busy: false, created: true, error: 'сеть', count: 1}), 'Повторить обновление');
 assert.equal(submitLabel({busy: false, created: false, error: 'сеть', count: 1}), 'Попробовать снова');
 assert.equal(submitLabel({busy: false, created: false, error: '', count: 2}), 'Создать группу');
 assert.equal(submitLabel({busy: false, created: false, error: '', count: 1}), 'Создать чат');
 assert.equal(limitNote(9), ' · Достигнут лимит участников');
 assert.equal(limitNote(1), ' · До 10 участников вместе с вами');
 assert.equal(emptyPeopleText(''), 'Здесь появятся ваши друзья и участники общих групп.');
 assert.equal(emptyPeopleText('а'), 'Никого не нашли. Попробуйте другое имя.');
 assert.equal(errorText(false, 'Сбой'), 'Сбой');
 assert.equal(errorText(true, 'Сбой'), 'Чат создан, но не удалось обновить список. Повторите обновление. Сбой');
});
