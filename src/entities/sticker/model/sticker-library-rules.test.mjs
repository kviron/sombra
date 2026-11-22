// Правила библиотеки стикеров: что видно, как называть наборы и как резать импорт.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
 archiveSizeError,
 catalogPackNote,
 groupStickersByPack,
 importCountError,
 libraryPackNote,
 libraryStickers,
 packName,
 personalSticker,
 shouldPreviewSentSticker,
 stickerBatches,
 stickerImageError,
 stickerKeywords,
 stickerName,
 stickerPackKey,
 titleFor
} from './sticker-library-rules.ts';

const sticker = (id, extra = {}) => ({id, owner: 'me', name: `Стикер ${id}`, ...extra});

test('личными считаются свои стикеры и стикеры установленных наборов', () => {
 assert.equal(personalSticker(sticker('a'), 'me'), true);
 assert.equal(personalSticker({...sticker('b'), owner: 'friend', packInstalled: true}, 'me'), true);
 assert.equal(personalSticker({...sticker('c'), owner: 'friend'}, 'me'), false);
 assert.equal(personalSticker({...sticker('d'), group: 'g1', packInstalled: true}, 'me'), false);
});

test('библиотека скрывает архивные и выбирает личные или групповые стикеры', () => {
 const stickers = [
  sticker('a'),
  sticker('b', {archived: true}),
  sticker('c', {group: 'g1'}),
  sticker('d', {owner: 'friend'})
 ];
 assert.deepEqual(
  libraryStickers(stickers, 'me').map(item => item.id),
  ['a']
 );
 assert.deepEqual(
  libraryStickers(stickers, 'me', 'g1').map(item => item.id),
  ['c']
 );
});

test('наборы группируются в порядке первого стикера и с ключом packId, pack или пустым', () => {
 const stickers = [
  {...sticker('a'), packId: 'p1', pack: 'Коты'},
  sticker('b'),
  {...sticker('c'), pack: 'Собаки'},
  {...sticker('d'), packId: 'p1'}
 ];
 const packs = groupStickersByPack(stickers);
 assert.deepEqual(
  packs.map(([key, items]) => [key, items.map(item => item.id)]),
  [
   ['p1', ['a', 'd']],
   ['', ['b']],
   ['Собаки', ['c']]
  ]
 );
 assert.equal(stickerPackKey(stickers[0]), 'p1');
 assert.equal(stickerPackKey(stickers[1]), '');
});

test('название набора берётся из черновика, манифеста, имени файла и обрезается', () => {
 assert.equal(packName('  Мой набор  ', 'Манифест', [{name: 'a.png'}]), 'Мой набор');
 assert.equal(packName('   ', 'Манифест', [{name: 'a.png'}]), 'Манифест');
 assert.equal(packName('', undefined, [{name: 'котики.png'}]), 'котики');
 assert.equal(packName('', undefined, [{name: 'a.png'}, {name: 'b.png'}]), 'Мои стикеры');
 assert.equal(packName('x'.repeat(80), undefined, []), 'x'.repeat(60));
});

test('названия стикеров обрезаются по символам и не бывают пустыми', () => {
 assert.equal(stickerName('  Котик  '), 'Котик');
 assert.equal(stickerName('   '), 'Стикер');
 assert.equal(stickerName('я'.repeat(50)), 'я'.repeat(40));
 assert.equal([...stickerName('😀'.repeat(50))].length, 40);
 assert.equal(titleFor('C:\\packs\\cat.png'), 'cat');
 assert.equal(titleFor('no-extension'), 'no-extension');
 assert.equal(titleFor('  .webp'), 'Стикер');
});

test('ключевые слова чистятся, не повторяются и ограничены 24', () => {
 assert.deepEqual(stickerKeywords([1, '  кот ', 'кот', 'x'.repeat(60)]), ['кот', 'x'.repeat(48)]);
 assert.equal(stickerKeywords('не массив'), undefined);
 assert.equal(stickerKeywords(Array.from({length: 30}, (_, index) => `тег${index}`)).length, 24);
});

test('импорт режется на пачки по 48 стикеров и по размеру запроса', () => {
 const batches = stickerBatches(Array.from({length: 100}, (_, index) => ({name: `s${index}`})));
 assert.deepEqual(
  batches.map(batch => batch.length),
  [48, 48, 4]
 );
 const heavy = stickerBatches([{data: 'a'.repeat(700_000)}, {data: 'b'}]);
 assert.deepEqual(
  heavy.map(batch => batch.length),
  [1, 1]
 );
});

test('подписи наборов показывают владельца, установку и публикацию', () => {
 assert.equal(catalogPackNote({count: 3, owner: 'me', installed: true}, 'me'), '3 шт. · Ваш набор');
 assert.equal(catalogPackNote({count: 3, owner: 'friend', installed: true}, 'me'), '3 шт. · Добавлен');
 assert.equal(catalogPackNote({count: 3, owner: 'friend', installed: false}, 'me'), '3 шт.');
 assert.equal(libraryPackNote(2, sticker('a', {packPublic: true}), false), '2 шт. · Опубликован');
 assert.equal(libraryPackNote(2, sticker('a'), true), '2 шт. · Добавлен');
});

test('набор открывается из отправленного стикера только в каталоге и не свой', () => {
 const published = sticker('a', {packId: 'p1', packPublic: true, owner: 'friend'});
 assert.equal(shouldPreviewSentSticker(published, 'me', true), true);
 assert.equal(shouldPreviewSentSticker(published, 'me', false), false);
 assert.equal(shouldPreviewSentSticker({...published, owner: 'me'}, 'me', true), false);
 assert.equal(shouldPreviewSentSticker({...published, packInstalled: true}, 'me', true), false);
 assert.equal(shouldPreviewSentSticker({...published, packAdded: true}, 'me', true), false);
 assert.equal(shouldPreviewSentSticker({...published, packPublic: false}, 'me', true), false);
});

test('ошибки выбора файла и пределы импорта совпадают с серверными', () => {
 assert.equal(stickerImageError({type: 'image/png', size: 1024}), '');
 assert.equal(stickerImageError({type: 'image/jpeg', size: 1024}), 'Выберите PNG или WebP до 8 МБ.');
 assert.equal(stickerImageError({type: 'image/png', size: 9 * 1024 * 1024}), 'Выберите PNG или WebP до 8 МБ.');
 assert.equal(importCountError(0), 'Добавьте от 1 до 200 изображений PNG или WebP.');
 assert.equal(importCountError(201), 'Добавьте от 1 до 200 изображений PNG или WebP.');
 assert.equal(importCountError(200), '');
 assert.equal(archiveSizeError(81 * 1024 * 1024), 'ZIP должен быть не больше 80 МБ.');
 assert.equal(archiveSizeError(1024), '');
});
