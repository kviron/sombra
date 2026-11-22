// Правила окна «Подключения»: список ботов, подписи строк, права владельца и запросы.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
 botIdentity,
 botPrivacyText,
 botRow,
 botStatusText,
 canOpenBotSettings,
 canRemoveBot,
 canRotateBotToken,
 createBotDisabled,
 createBotPayload,
 managedBotOf,
 visibleBots
} from './chat-bots-rules.ts';

const me = {id: 'me', name: 'Я', bio: '', created_at: 0};
const bots = [
 {id: 'group-bot', name: 'Групповой', owner: 'me', groups: ['g1'], last_seen: 1_000},
 {id: 'old-bot', name: 'Старый', owner: 'me', group: 'g1'},
 {id: 'room-bot', name: 'Комнатный', owner: 'anya', channel: 'c1'}
];
const state = {
 me,
 email: 'me@example.com',
 users: [
  me,
  {id: 'anya', name: 'Аня', bio: '', created_at: 0},
  {id: 'group-bot', name: 'Групповой', bio: '', created_at: 0, bot: true}
 ],
 groups: [],
 dialogs: [],
 messages: [],
 stickers: [],
 friends: [],
 bots
};

test('в группе видны боты группы и боты её канала, вне группы — только боты комнаты', () => {
 assert.deepEqual(
  visibleBots(state, 'c1', 'g1').map(bot => bot.id),
  ['group-bot', 'old-bot', 'room-bot']
 );
 assert.deepEqual(
  visibleBots(state, 'c1', undefined).map(bot => bot.id),
  ['room-bot']
 );
 assert.deepEqual(visibleBots(state, 'c2', undefined), [], 'бот другой комнаты не показывается');
 assert.deepEqual(visibleBots({...state, bots: []}, 'c1', 'g1'), []);
});

test('состояние сервиса: отключён, подключён или давно молчит', () => {
 const now = 1_050;
 assert.equal(botStatusText(bots[0], now), 'Сервис подключён');
 assert.equal(botStatusText(bots[1], now), 'Нет недавней активности сервиса');
 assert.equal(botStatusText({...bots[0], enabled: false}, now), 'Отключён');
 assert.equal(botStatusText({...bots[0], last_seen: now - 120}, now), 'Нет недавней активности сервиса');
});

test('что читает бот: комната или режим приватности из настроек', () => {
 assert.equal(botPrivacyText(bots[2]), 'Доступ к истории этой комнаты');
 assert.equal(botPrivacyText({...bots[1], privacy: false}), 'Читает все сообщения разрешённых чатов');
 assert.equal(botPrivacyText({...bots[1], privacy: 'all'}), 'Читает все сообщения разрешённых чатов');
 assert.equal(botPrivacyText(bots[1]), 'Команды и упоминания; личные сообщения — в отдельном диалоге');
});

test('права строки: настройки, ключ и отключение', () => {
 assert.equal(canOpenBotSettings(state, bots[0]), true);
 assert.equal(canOpenBotSettings({...state, me: {...me, bot: true}}, bots[0]), false);
 assert.equal(canOpenBotSettings(state, bots[2]), false, 'чужой бот');
 assert.equal(canRotateBotToken(state, bots[1], true), true);
 assert.equal(canRotateBotToken(state, bots[2], true), false, 'ключ меняет владелец');
 assert.equal(canRotateBotToken(state, {...bots[1], channel: 'c1'}, false), false, 'в канале нужен владелец чата');
 assert.equal(canRotateBotToken(state, {...bots[1], channel: 'c1'}, true), true);
 assert.equal(canRemoveBot(true), true);
 assert.equal(canRemoveBot(false), false);
 assert.equal(managedBotOf(state, 'group-bot')?.id, 'group-bot');
 assert.equal(managedBotOf(state, 'room-bot'), undefined, 'открывать можно только своего бота');
});

test('создание бота: кнопка активна по имени, а логин нужен только в группе', () => {
 assert.equal(createBotDisabled({busy: false, name: 'Помощник', group: 'g1', username: 'team_bot'}), false);
 assert.equal(createBotDisabled({busy: true, name: 'Помощник', group: 'g1', username: 'team_bot'}), true);
 assert.equal(createBotDisabled({busy: false, name: '  ', group: 'g1', username: 'team_bot'}), true);
 assert.equal(createBotDisabled({busy: false, name: 'Помощник', group: 'g1', username: ''}), true);
 assert.equal(createBotDisabled({busy: false, name: 'Помощник', group: undefined, username: ''}), false);
 assert.deepEqual(createBotPayload({group: 'g1', channel: 'c1', name: ' Помощник ', username: ' @team_bot '}), {
  group: 'g1',
  name: 'Помощник',
  username: 'team_bot'
 });
 assert.deepEqual(createBotPayload({group: undefined, channel: 'c1', name: ' Помощник ', username: ''}), {
  channel: 'c1',
  name: 'Помощник'
 });
});

test('готовая строка собирает подписи и права из одного расчёта', () => {
 const row = botRow({state, bot: bots[0], owner: true, now: 1_050});
 assert.equal(row.user.name, 'Групповой');
 assert.equal(row.user.bot, true, 'бот найден в списке людей');
 assert.equal(row.status, 'Сервис подключён');
 assert.equal(row.settings, true);
 assert.equal(row.token, true);
 assert.equal(row.remove, true);
 assert.deepEqual(row.commands, []);
 const fallback = botIdentity(state, bots[1]);
 assert.deepEqual(fallback, {id: 'old-bot', name: 'Старый'}, 'без записи в людях — имя бота');
});
