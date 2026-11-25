// Правила активности бота: разбор записи, истечение окна, картинка и подписи.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
 NEUTRAL_STAGE,
 activeEntries,
 botIdentity,
 earliestUntil,
 expiryDelay,
 hasLiveImageActivity,
 imageActivityLabel,
 imageDelivered,
 isImageActivity,
 readActivity,
 typingAnnouncement,
 typingBotNames,
 typingKeys,
 typingStage
} from './bot-typing-rules.ts';

const state = {
 me: {id: 'me', name: 'Я', bio: '', created_at: 0},
 users: [
  {id: 'me', name: 'Я', bio: '', created_at: 0},
  {id: 'b1', name: 'Помощник', bio: '', created_at: 0, bot: true}
 ],
 bots: [{id: 'b1', name: 'Помощник', owner: 'me'}],
 messages: [],
 botTyping: []
};

test('код активности важнее свободного текста, а готовый статус — важнее кода', () => {
 const coded = readActivity({bot: 'b1', channel: 'c1', until: 100, activity: 'tool'});
 assert.equal(coded.code, 'tool');
 assert.equal(coded.stage, 'Выполняет инструмент');
 const labelled = readActivity({bot: 'b1', channel: 'c1', until: 100, activity: 'image', status: 'Рисую кота'});
 assert.equal(labelled.stage, 'Рисую кота', 'status побеждает код');
 const legacy = readActivity({bot: 'b1', channel: 'c1', until: 100, stage: 'Старый этап'});
 assert.equal(legacy.code, '');
 assert.equal(legacy.stage, 'Старый этап');
 const free = readActivity({bot: 'b1', channel: 'c1', until: 100, activity: 'свободный текст'});
 assert.equal(free.code, '', 'незнакомый код — не код');
 assert.equal(free.stage, 'свободный текст');
});

test('длинный текст обрезается, а подробность не повторяет строку этапа', () => {
 const long = 'а'.repeat(300);
 const activity = readActivity({bot: 'b1', channel: 'c1', until: 100, activity: 'tool', detail: long});
 assert.equal(activity.detail.length, 240, 'подробность держит свой предел');
 const short = readActivity({bot: 'b1', channel: 'c1', until: 100, activity: 'код', status: 'код'});
 assert.equal(short.detail, '', 'строка этапа не дублируется в подробности');
});

test('started_at принимается в секундах, строках и ISO, и только в прошлом', () => {
 const seconds = readActivity({bot: 'b1', channel: 'c1', until: 100, started_at: 1_700_000_000});
 assert.equal(seconds.startedAt, 1_700_000_000_000);
 const camel = readActivity({bot: 'b1', channel: 'c1', until: 100, startedAt: 1_700_000_000});
 assert.equal(camel.startedAt, 1_700_000_000_000, 'старое поле тоже читается');
 const iso = readActivity({bot: 'b1', channel: 'c1', until: 100, started_at: '2023-11-14T22:13:20.000Z'});
 assert.equal(iso.startedAt, 1_700_000_000_000);
 assert.equal(readActivity({bot: 'b1', channel: 'c1', until: 100}).startedAt, undefined);
 assert.equal(readActivity({bot: 'b1', channel: 'c1', until: 100, started_at: -5}).startedAt, undefined);
});

test('истёкшее окно не показывается, а чужой канал в расчёт не идёт', () => {
 const rows = [
  {bot: 'b1', channel: 'c1', until: 200},
  {bot: 'b1', channel: 'c2', until: 300},
  {bot: 'b2', channel: 'c1', until: 50}
 ];
 const active = activeEntries({botTyping: rows}, 'c1', 100);
 assert.deepEqual(
  active.map(item => item.bot),
  ['b1'],
  'просроченная и чужая запись отброшены'
 );
 assert.deepEqual(activeEntries({botTyping: rows}, 'c1', 200), []);
 assert.deepEqual(activeEntries({}, 'c1', 100), []);
 assert.equal(earliestUntil({botTyping: rows}, 'c1'), 50);
 assert.equal(earliestUntil({botTyping: rows}, 'c9'), undefined);
 assert.equal(typingKeys({botTyping: rows}), 'b1@200|b1@300|b2@50');
});

test('картинка скрывает карточку, как только бот её прислал', () => {
 const entry = {bot: 'b1', channel: 'c1', until: 500, activity: 'image', started_at: 1_700_000_000};
 const picture = {
  id: 'm1',
  channel: 'c1',
  user: 'b1',
  text: '',
  time: 1_700_000_010,
  attachment: {id: 'a1', name: 'кот.png', size: 10, mime: 'image/png'}
 };
 assert.equal(imageDelivered({messages: []}, entry), false);
 assert.equal(imageDelivered({messages: [picture]}, entry), true);
 assert.equal(
  imageDelivered({messages: [{...picture, time: 1_699_999_000}]}, entry),
  false,
  'картинка до начала генерации не считается'
 );
 assert.equal(
  imageDelivered({messages: [{...picture, attachment: {...picture.attachment, mime: 'text/plain'}}]}, entry),
  false
 );
 assert.equal(
  imageDelivered({messages: [{...picture, channel: 'c2'}]}, entry),
  false,
  'чужой канал не скрывает карточку'
 );
});

test('живая генерация картинки известна странице по тем же правилам', () => {
 const typing = {botTyping: [{bot: 'b1', channel: 'c1', until: 500, activity: 'image'}]};
 assert.equal(hasLiveImageActivity(typing, 'c1', 100), true);
 assert.equal(hasLiveImageActivity(typing, 'c2', 100), false);
 assert.equal(hasLiveImageActivity(typing, 'c1', 500), false, 'окно истекло');
 assert.equal(isImageActivity({bot: 'b1', channel: 'c1', until: 500, activity: 'image'}), true);
 assert.equal(isImageActivity({bot: 'b1', channel: 'c1', until: 500, activity: 'tool'}), false);
});

test('имена активных ботов берутся из списка людей', () => {
 assert.deepEqual(typingBotNames({...state, botTyping: [{bot: 'b1', channel: 'c1', until: 500}]}, 'c1', 100), [
  'Помощник'
 ]);
 assert.deepEqual(typingBotNames({...state, botTyping: [{bot: 'b1', channel: 'c1', until: 50}]}, 'c1', 100), []);
 assert.deepEqual(typingBotNames({...state, botTyping: []}, 'c1', 100), []);
 assert.deepEqual(botIdentity(state, 'b1'), {name: 'Помощник', user: state.users[1]});
 assert.deepEqual(botIdentity(state, 'нет-такого'), {name: 'Сомбра', user: undefined});
});

test('подписи строки и карточки не выдумывают этап', () => {
 const idle = readActivity({bot: 'b1', channel: 'c1', until: 100});
 assert.equal(typingStage(idle), NEUTRAL_STAGE);
 assert.equal(typingAnnouncement('Помощник', idle.stage), 'Помощник печатает…');
 assert.equal(typingAnnouncement('Помощник', 'Ищет'), 'Помощник печатает: Ищет');
 assert.equal(imageActivityLabel(idle), 'Генерирую изображение…');
 assert.equal(imageActivityLabel({...idle, status: 'Рисую'}), 'Рисую');
});

test('таймер окна взводится только на будущее и с запасом', () => {
 assert.equal(expiryDelay(100, 99_000), 1025);
 assert.equal(expiryDelay(100, 100_000), undefined, 'просроченное окно не взводит таймер');
 assert.equal(expiryDelay(Number.NaN, 0), undefined);
 assert.equal(expiryDelay(0.001, 0), 60, 'слишком короткая задержка не крутит часы');
});
