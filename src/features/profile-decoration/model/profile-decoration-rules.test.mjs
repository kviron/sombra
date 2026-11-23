// Правила выбора украшения: личная коллекция, страницы каталога, GIF и черновик генерации.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
 appendEffectPage,
 asChoice,
 draftResult,
 effectKind,
 gifFileProblem,
 isCurrentEffect,
 isDraftPending,
 isGifHeader,
 localChoices,
 personalEffects
} from './profile-decoration-rules.ts';

const effect = (id, target, extra = {}) => ({
 id,
 target,
 title: `Эффект ${id}`,
 decoration: {mode: 'frame', seed: id},
 ownerId: 'me',
 public: false,
 ...extra
});
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const presets = [
 {key: 'ember-crown', title: 'Огненная рамка', decoration: {mode: 'frame', seed: 'ember'}},
 {key: 'slime-pet', title: 'Слайм в углу', decoration: {mode: 'frame', seed: 'slime'}}
];

test('запись каталога превращается в выбор с идентификатором и ассетом', () => {
 const asset = {id: 'a1', mime: 'image/gif', width: 32, height: 32, frames: 2, size: 100};
 const choice = asChoice(effect('e1', 'avatar', {asset}));
 assert.equal(choice.key, 'effect:e1');
 assert.equal(choice.id, 'e1');
 assert.equal(choice.title, 'Эффект e1');
 assert.equal(choice.asset, asset);
});

test('личная коллекция показывает свежие загрузки для своей цели и не дублирует страницу', () => {
 const recent = [effect('new-avatar', 'avatar'), effect('new-cover', 'cover')];
 const page = [effect('new-avatar', 'avatar'), effect('old-avatar', 'avatar')];
 const shown = personalEffects(recent, page, 'avatar');
 assert.deepEqual(
  shown.map(item => item.id),
  ['new-avatar', 'old-avatar']
 );
 assert.deepEqual(
  personalEffects([], page, 'cover').map(item => item.id),
  ['new-avatar', 'old-avatar'],
  'без загрузок остаётся страница'
 );
});

test('следующая страница каталога дополняет список без повторов', () => {
 const previous = {items: [effect('a', 'avatar'), effect('b', 'avatar')], nextOffset: 2};
 const next = appendEffectPage(previous, {items: [effect('b', 'avatar'), effect('c', 'avatar')], nextOffset: null});
 assert.deepEqual(
  next.items.map(item => item.id),
  ['a', 'b', 'c']
 );
 assert.equal(next.nextOffset, null);
});

test('GIF проверяется по размеру и типу файла', () => {
 const maxBytes = 2 * 1024 * 1024;
 assert.equal(gifFileProblem({size: maxBytes + 1, type: 'image/gif'}, maxBytes), 'GIF должен быть не больше 2 МиБ.');
 assert.equal(gifFileProblem({size: 100, type: 'image/png'}, maxBytes), 'Выберите файл GIF.');
 assert.equal(gifFileProblem({size: 3, type: 'image/gif'}, maxBytes), 'Выберите файл GIF.');
 assert.equal(gifFileProblem({size: 100, type: 'image/gif'}, maxBytes), '');
});

test('подпись GIF распознаётся по обеим версиям формата', () => {
 assert.equal(isGifHeader('GIF87a'), true);
 assert.equal(isGifHeader('GIF89a'), true);
 assert.equal(isGifHeader('GIF90a'), false);
 assert.equal(isGifHeader('PNG89a'), false);
});

test('черновик готов к сохранению только после успешной генерации', () => {
 const draft = {id: 'd1', status: 'ready', result: {title: 'Искры', decoration: {mode: 'frame'}}};
 assert.equal(
  draftResult({...draft, status: 'queued'}, () => true),
  undefined
 );
 assert.equal(
  draftResult({...draft, status: 'failed'}, () => true),
  undefined
 );
 assert.equal(
  draftResult(draft, () => false),
  undefined
 );
 assert.deepEqual(
  draftResult(draft, () => true),
  draft.result
 );
 assert.equal(isDraftPending({id: 'd1', status: 'running'}), true);
 assert.equal(isDraftPending({id: 'd1', status: 'ready', result: draft.result}), false);
});

test('подпись карточки различает GIF, анимацию и стандартный вид', () => {
 assert.equal(
  effectKind({
   key: 'gif',
   title: 'GIF',
   decoration: null,
   asset: {id: 'a1', mime: 'image/gif', width: 1, height: 1, frames: 1, size: 1}
  }),
  'GIF-анимация'
 );
 assert.equal(effectKind({key: 'frame', title: 'Рамка', decoration: {mode: 'frame'}}), 'Анимированный эффект');
 assert.equal(effectKind({key: 'none', title: 'Без рамки', decoration: null}), 'Стандартный вид');
});

test('текущий эффект определяется по идентификатору, затем по документу', () => {
 const item = {key: 'effect:e1', id: 'e1', title: 'Эффект', decoration: {mode: 'frame'}};
 assert.equal(isCurrentEffect(item, 'e1', null, same), true);
 assert.equal(isCurrentEffect(item, 'e2', null, same), false);
 assert.equal(
  isCurrentEffect({key: 'frame', title: 'Рамка', decoration: {mode: 'frame'}}, undefined, {mode: 'frame'}, same),
  true
 );
});

test('локальные варианты: «без эффекта» на своём месте, каталог без них, текущий документ добавляется', () => {
 const avatar = localChoices({
  view: 'personal',
  target: 'avatar',
  presets,
  currentDoc: null,
  currentRef: undefined,
  same
 });
 assert.deepEqual(
  avatar.map(item => item.key),
  ['none', 'ember-crown', 'slime-pet']
 );
 const currentDoc = {mode: 'frame', seed: 'custom'};
 const withCurrent = localChoices({
  view: 'personal',
  target: 'avatar',
  presets,
  currentDoc,
  currentRef: undefined,
  same
 });
 assert.deepEqual(
  withCurrent.map(item => item.key),
  ['none', 'current', 'ember-crown', 'slime-pet']
 );
 const fromRef = localChoices({view: 'personal', target: 'avatar', presets, currentDoc, currentRef: 'e1', same});
 assert.equal(
  fromRef.some(item => item.key === 'current'),
  false,
  'эффект из каталога не дублируется документом'
 );
 assert.deepEqual(
  localChoices({view: 'catalog', target: 'avatar', presets, currentDoc, currentRef: undefined, same}),
  []
 );
 assert.equal(
  localChoices({view: 'personal', target: 'cover', presets: [], currentDoc: null, currentRef: undefined, same}).at(-1)
   .key,
  'none'
 );
});
