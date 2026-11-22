// Правила панели эмодзи и стикеров: категории, поиск, наборы и права.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
 canManageStickers,
 emojiCategoryOptions,
 resolvePack,
 stickerPackOptions,
 visibleEmojiIds,
 visibleStickers
} from './expression-picker-rules.ts';

const emojis = {
 grin: {name: 'Улыбка', keywords: ['лицо', 'смех'], skins: [{native: '😀'}]},
 fire: {name: 'Огонь', keywords: ['жар'], skins: [{native: '🔥'}]},
 cat: {name: 'Кот', skins: [{native: '🐱'}]}
};
const categories = [
 {id: 'people', emojis: ['grin', 'cat']},
 {id: 'symbols', emojis: ['fire']}
];

test('без запроса показывается выбранная категория', () => {
 assert.deepEqual(visibleEmojiIds({emojis, categories, category: 'symbols', query: ''}), ['fire']);
 assert.deepEqual(visibleEmojiIds({emojis, categories, category: 'нет такой', query: ''}), []);
});

test('поиск идёт по имени, ключевым словам и самому эмодзи', () => {
 assert.deepEqual(visibleEmojiIds({emojis, categories, category: 'people', query: 'улыб'}), ['grin']);
 assert.deepEqual(visibleEmojiIds({emojis, categories, category: 'people', query: 'жар'}), ['fire']);
 assert.deepEqual(visibleEmojiIds({emojis, categories, category: 'people', query: ' 🔥 '}), ['fire']);
 assert.deepEqual(visibleEmojiIds({emojis, categories, category: 'people', query: 'кот'}), ['cat']);
 assert.deepEqual(visibleEmojiIds({emojis, categories, category: 'people', query: 'нет'}), []);
});

test('подписи категорий берутся из словаря, неизвестная — по идентификатору', () => {
 assert.deepEqual(emojiCategoryOptions([{id: 'people'}, {id: 'custom'}]), [
  {value: 'people', label: 'Люди'},
  {value: 'custom', label: 'custom'}
 ]);
});

test('наборы стикеров: «Все наборы» плюс именованные', () => {
 const packs = new Map([
  ['', ''],
  ['pack-1', 'Коты'],
  ['pack-2', 'Собаки']
 ]);
 assert.deepEqual(stickerPackOptions(packs), [
  {value: '', label: 'Все наборы'},
  {value: 'pack-1', label: 'Коты'},
  {value: 'pack-2', label: 'Собаки'}
 ]);
 assert.equal(resolvePack(packs, 'pack-2'), 'pack-2');
 assert.equal(resolvePack(packs, 'удалённый'), '');
});

test('стикеры фильтруются по активному набору', () => {
 const library = [
  {id: 's1', owner: 'me', name: 'Кот', pack: 'Коты'},
  {id: 's2', owner: 'me', name: 'Пёс', pack: 'Собаки'},
  {id: 's3', owner: 'me', name: 'Без набора'}
 ];
 const key = sticker => sticker.pack || '';
 assert.deepEqual(
  visibleStickers(library, 'Коты', key).map(sticker => sticker.id),
  ['s1']
 );
 assert.deepEqual(
  visibleStickers(library, '', key).map(sticker => sticker.id),
  ['s1', 's2', 's3']
 );
});

test('управление групповыми стикерами требует права', () => {
 assert.equal(canManageStickers('personal', false), true);
 assert.equal(canManageStickers('group', false), false);
 assert.equal(canManageStickers('group', true), true);
});
