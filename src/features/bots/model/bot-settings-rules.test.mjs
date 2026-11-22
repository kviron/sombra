// Правила настроек бота: права, черновик, проверки, ответы сервера и тексты ошибок.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
 botSettingsResponse,
 canManageBot,
 currentModelLabel,
 currentReasoningLabel,
 draftConversation,
 invalidAliases,
 managementSupported,
 modelCatalog,
 modelDirty,
 modelInvalid,
 modelLoadError,
 modelOptions,
 modelSaveError,
 modelSettingsResponse,
 parseAliases,
 settingsDirty,
 settingsInvalid
} from './bot-settings-rules.ts';

const bot = {id: 'b1', name: 'Бот', owner: 'me', username: 'bot', managementVersion: 1};
const me = {id: 'me', name: 'Я', bio: '', created_at: 0};
const chat = {me, users: [], groups: [], dialogs: [], messages: [], stickers: [], friends: [], bots: [], email: ''};
const conversation = {
 mode: 'addressed',
 aliases: ['сомбра'],
 followupSeconds: 180,
 followupMessages: 8,
 reactions: true
};
const loaded = {bot, profile: {name: 'Бот', bio: 'Описание'}, revision: 2, conversation};

test('настройки доступны только владельцу и не самому боту', () => {
 assert.equal(canManageBot(chat, bot), true);
 assert.equal(canManageBot({...chat, me: {...me, bot: true}}, bot), false);
 assert.equal(canManageBot(chat, {...bot, owner: 'friend'}), false);
 assert.equal(managementSupported(bot), true);
 assert.equal(managementSupported({...bot, managementVersion: 0}), false);
 assert.equal(managementSupported({...bot, channel: 'c1'}), false);
});

test('имена для обращения разбираются и проверяются по правилам сервера', () => {
 assert.deepEqual(parseAliases(' Сомбра, бот\nассистент '), ['Сомбра', 'бот', 'ассистент']);
 assert.equal(invalidAliases(['a']), true, 'имя короче двух символов');
 assert.equal(invalidAliases(['all']), true, 'общее обращение');
 assert.equal(invalidAliases(['все']), true, 'общее обращение по-русски');
 assert.equal(invalidAliases(['x'.repeat(33)]), true, 'имя длиннее 32 символов');
 assert.equal(invalidAliases(Array.from({length: 9}, (_, index) => `имя${index}`)), true);
 assert.equal(invalidAliases(['сомбра', 'бот']), false);
 assert.deepEqual(draftConversation(conversation, 'сомбра, бот')?.aliases, ['сомбра', 'бот']);
 assert.equal(draftConversation(undefined, 'сомбра'), undefined);
});

test('черновик считается изменённым по имени, описанию, аватару и общению', () => {
 assert.equal(settingsDirty(loaded, {name: 'Бот', bio: 'Описание', avatar: undefined, conversation}), false);
 assert.equal(settingsDirty(loaded, {name: 'Новый', bio: 'Описание', avatar: undefined, conversation}), true);
 assert.equal(settingsDirty(loaded, {name: 'Бот', bio: 'Описание', avatar: '', conversation}), true);
 assert.equal(
  settingsDirty(loaded, {
   name: 'Бот',
   bio: 'Описание',
   avatar: undefined,
   conversation: {...conversation, aliases: ['другой']}
  }),
  true
 );
 assert.equal(settingsDirty(undefined, {name: 'Бот', bio: '', avatar: undefined, conversation: undefined}), false);
});

test('проверки перед сохранением отсекают пустое имя, длинное описание и пределы общения', () => {
 assert.equal(settingsInvalid('Бот', 'Описание', ['сомбра'], conversation), false);
 assert.equal(settingsInvalid('  ', 'Описание', ['сомбра'], conversation), true);
 assert.equal(settingsInvalid('Б'.repeat(33), 'Описание', ['сомбра'], conversation), true);
 assert.equal(settingsInvalid('Бот', 'о'.repeat(513), ['сомбра'], conversation), true);
 assert.equal(settingsInvalid('Бот', 'Описание', ['all'], conversation), true);
 assert.equal(settingsInvalid('Бот', 'Описание', ['сомбра'], undefined), true);
 assert.equal(settingsInvalid('Бот', 'Описание', ['сомбра'], {...conversation, followupSeconds: NaN}), true);
 assert.equal(settingsInvalid('Бот', 'Описание', ['сомбра'], {...conversation, followupSeconds: -1}), true);
 assert.equal(settingsInvalid('Бот', 'Описание', ['сомбра'], {...conversation, followupSeconds: 601}), true);
 assert.equal(settingsInvalid('Бот', 'Описание', ['сомбра'], {...conversation, followupMessages: 21}), true);
});

test('ответ настроек бота принимается только для этого бота и с целой ревизией', () => {
 assert.equal(botSettingsResponse(loaded, bot, 'me'), loaded);
 assert.throws(() => botSettingsResponse({...loaded, bot: {...bot, id: 'b2'}}, bot, 'me'), /invalid/);
 assert.throws(() => botSettingsResponse({...loaded, bot: {...bot, owner: 'friend'}}, bot, 'me'), /invalid/);
 assert.throws(() => botSettingsResponse({...loaded, revision: 1.5}, bot, 'me'), /invalid/);
 assert.throws(() => botSettingsResponse({...loaded, profile: undefined}, bot, 'me'), /invalid/);
});

test('ответ настроек модели проверяется целиком', () => {
 const settings = {
  model: 'gpt-4o',
  reasoning: 'low',
  revision: 0,
  modelDefault: false,
  reasoningDefault: false
 };
 assert.equal(modelSettingsResponse(settings), settings);
 assert.throws(() => modelSettingsResponse(null), /Некорректный ответ/);
 assert.throws(() => modelSettingsResponse({...settings, model: 'gpt 4o'}), /Некорректный ответ/);
 assert.throws(() => modelSettingsResponse({...settings, reasoning: 'max'}), /Некорректный ответ/);
 assert.throws(() => modelSettingsResponse({...settings, revision: -1}), /Некорректный ответ/);
 assert.throws(() => modelSettingsResponse({...settings, modelDefault: 'yes'}), /Некорректный ответ/);
});

test('каталог моделей чистится, не повторяется и ограничен 12', () => {
 assert.deepEqual(modelCatalog({...bot, modelSettings: {models: ['a', 'a', 'bad model', '', 5, 'b']}}), ['a', 'b']);
 assert.deepEqual(modelCatalog(bot), []);
 assert.equal(
  modelCatalog({...bot, modelSettings: {models: Array.from({length: 20}, (_, index) => `m${index}`)}}).length,
  12
 );
});

test('черновик модели и опции панели совпадают с загруженным', () => {
 const settings = modelSettingsResponse({
  model: 'gpt-4o',
  reasoning: 'low',
  revision: 1,
  modelDefault: false,
  reasoningDefault: false
 });
 assert.equal(modelInvalid(''), false, 'пустое значение — модель по умолчанию');
 assert.equal(modelInvalid('gpt-4o'), false);
 assert.equal(modelInvalid('gpt 4o'), true);
 assert.equal(modelInvalid('x'.repeat(121)), true);
 assert.equal(modelDirty(settings, ' gpt-4o ', 'low'), false);
 assert.equal(modelDirty(settings, 'gpt-4o', 'high'), true);
 assert.deepEqual(modelOptions([], settings), ['', 'gpt-4o']);
 assert.deepEqual(modelOptions(['a', 'a'], undefined), ['', 'a']);
 assert.equal(currentModelLabel(undefined), '');
 assert.equal(currentModelLabel({...settings, modelDefault: true}), 'модель по умолчанию');
 assert.equal(currentModelLabel(settings), 'gpt-4o');
 assert.equal(
  currentReasoningLabel({...settings, reasoningDefault: true, reasoning: 'high'}),
  'размышление по умолчанию'
 );
 assert.equal(currentReasoningLabel(settings), 'низкий');
});

test('тексты ошибок модели различают запрет, неподдерживаемый сервер и сбой', () => {
 assert.match(modelLoadError('BOT_SETTINGS_FORBIDDEN'), /доступны только владельцу/);
 assert.match(modelLoadError('unknown method'), /не поддерживает настройки модели/);
 assert.match(modelLoadError('boom'), /Не удалось загрузить/);
 assert.match(modelSaveError('BOT_SETTINGS_FORBIDDEN'), /только владелец/);
 assert.match(modelSaveError('BOT_SETTINGS_INVALID'), /Сервер отклонил значения/);
 assert.match(modelSaveError('boom'), /сервер не подтвердил изменения/);
});
