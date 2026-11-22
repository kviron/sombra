// Правила профиля человека: даты, общие группы, дружба, украшения и заметка.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
 activityText,
 effectErrorMessage,
 effectFeedbackText,
 effectOffers,
 formatDay,
 friendNote,
 isSelf,
 noteKey,
 noteSavedLabel,
 participantWord,
 sharedGroups
} from './user-profile-rules.ts';

const me = {id: 'me', name: 'Я', bio: '', created_at: 0};
const person = {id: 'u1', name: 'Аня', bio: '', created_at: 1600000000};
const bot = {id: 'b1', name: 'Бот', bio: '', created_at: 0, bot: true};

const decorated = {
 ...person,
 decorations: {avatar: {v: 1}, cover: {v: 1}},
 decorationRefs: {avatar: 'fx-avatar', cover: 'fx-cover'}
};

test('заметка адресуется парой «аккаунт + человек»', () => {
 assert.equal(noteKey('me', 'u1'), 'sombra-profile-note:me:u1');
 assert.notEqual(noteKey('me', 'u1'), noteKey('me', 'u2'));
 assert.notEqual(noteKey('me', 'u1'), noteKey('other', 'u1'));
});

test('свой профиль отличается от чужого', () => {
 assert.equal(isSelf(me, me), true);
 assert.equal(isSelf(person, me), false);
});

test('общие группы считаются по участникам', () => {
 const groups = [
  {id: 'g1', name: 'Свои', owner: 'me', invite: '', members: ['me', 'u1'], channels: []},
  {id: 'g2', name: 'Работа', owner: 'me', invite: '', members: ['me'], channels: []}
 ];
 assert.deepEqual(
  sharedGroups(groups, 'u1').map(group => group.id),
  ['g1']
 );
 assert.deepEqual(sharedGroups(groups, 'me'), groups, 'в своих группах состоите вы');
});

test('запись о дружбе не показывается себе и боту', () => {
 assert.equal(friendNote('friends', me, true), null);
 assert.equal(friendNote('friends', bot, false), null);
 assert.equal(friendNote('friends', person, false), 'friends');
 assert.equal(friendNote('outgoing', person, false), 'outgoing');
 assert.equal(friendNote('incoming', person, false), 'incoming');
 assert.equal(friendNote('none', person, false), null);
});

test('участники группы склоняются как в разметке', () => {
 assert.equal(participantWord(1), 'участник');
 assert.equal(participantWord(3), 'участника');
 assert.equal(participantWord(5), 'участников');
 assert.equal(participantWord(11), 'участников');
});

test('украшение можно поставить себе только с серверной ссылкой и не боту', () => {
 const offers = effectOffers({user: decorated, me, enabled: true});
 assert.deepEqual(
  offers.map(item => [item.target, item.id, item.label, item.applied]),
  [
   ['avatar', 'fx-avatar', 'Рамка аватара', false],
   ['cover', 'fx-cover', 'Эффект обложки', false]
  ]
 );
 assert.deepEqual(effectOffers({user: decorated, me, enabled: false}), []);
 assert.deepEqual(effectOffers({user: decorated, me: {...me, id: 'u1'}, enabled: true}), []);
 assert.deepEqual(effectOffers({user: person, me, enabled: true}), [], 'без ссылок сервер ничего не отдал');
});

test('уже применённое украшение отмечается', () => {
 const offers = effectOffers({user: decorated, me: {...me, decorationRefs: {avatar: 'fx-avatar'}}, enabled: true});
 assert.equal(offers[0].applied, true);
 assert.equal(offers[1].applied, false);
});

test('тексты обратной связи и заметки', () => {
 assert.equal(effectFeedbackText('avatar'), 'Рамка применена');
 assert.equal(effectFeedbackText('cover'), 'Эффект обложки применён');
 assert.equal(effectErrorMessage(new Error('Сеть недоступна')), 'Сеть недоступна');
 assert.equal(effectErrorMessage('что-то'), 'Не удалось применить эффект');
 assert.equal(noteSavedLabel(true), 'Сохранено');
 assert.equal(noteSavedLabel(false), 'Видна только вам');
});

test('дата регистрации и последняя активность по-русски', () => {
 assert.match(formatDay(1600000000), /2020/);
 assert.match(activityText({...person, online: false, last_seen: 1700000000}), /\d{2}:\d{2}$/);
 assert.equal(activityText({...person, online: true}), 'сейчас');
 assert.equal(activityText(person), 'неизвестно');
});
