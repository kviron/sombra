// Правила перетаскивания файлов: тип переноса, приём и причины отказа.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
 acceptingDrops,
 dropEffectFor,
 dropError,
 dropOverlayVisible,
 hasDraggedFiles,
 isFileItem
} from './attachment-drop-zone-rules.ts';

test('перетаскивание файлов распознаётся по типу, элементам и файлам', () => {
 assert.equal(hasDraggedFiles(null), false);
 assert.equal(hasDraggedFiles(undefined), false);
 assert.equal(hasDraggedFiles({types: ['text/plain'], items: [], files: []}), false);
 assert.equal(hasDraggedFiles({types: ['Files']}), true);
 assert.equal(hasDraggedFiles({types: [], items: [{kind: 'file'}]}), true, 'файлы без типа Files');
 assert.equal(hasDraggedFiles({types: [], files: [{name: 'a.png'}]}), true, 'файлы уже доступны');
 assert.equal(hasDraggedFiles({types: [], items: [{kind: 'string'}]}), false);
});

test('зона принимает файлы только при открытой переписке', () => {
 assert.equal(acceptingDrops('c1', false), true);
 assert.equal(acceptingDrops('c1', true), false, 'окно перекрыто');
 assert.equal(acceptingDrops(undefined, false), false, 'переписка не выбрана');
 assert.equal(acceptingDrops('', false), false);
});

test('подсказка показывается только во время приёма', () => {
 assert.equal(dropOverlayVisible(true, true), true);
 assert.equal(dropOverlayVisible(true, false), false);
 assert.equal(dropOverlayVisible(false, true), false);
 assert.equal(dropEffectFor(true), 'copy');
 assert.equal(dropEffectFor(false), 'none');
});

test('элемент переноса считается файлом по kind', () => {
 assert.equal(isFileItem({kind: 'file'}), true);
 assert.equal(isFileItem({kind: 'string'}), false);
 assert.equal(isFileItem({}), false);
});

test('причина отказа объясняет папку, несколько файлов и пустой сброс', () => {
 assert.equal(dropError({directories: true, count: 1}), 'Перетащите файл, а не папку.');
 assert.equal(dropError({directories: false, count: 3}), 'Пока можно прикрепить один файл за раз.');
 assert.equal(dropError({directories: false, count: 0}), 'Не удалось получить файл. Попробуйте кнопку вложения.');
 assert.equal(dropError({directories: false, count: 1}), '');
 assert.equal(dropError({directories: true, count: 0}), 'Перетащите файл, а не папку.', 'папка важнее счётчика');
});
