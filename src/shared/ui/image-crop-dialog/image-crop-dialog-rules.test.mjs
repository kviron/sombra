// Правила окна кадрирования: пропорции, уменьшение предпросмотра и готовность к сохранению.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
 applyErrorMessage,
 canApplyCrop,
 cropAspect,
 cropFromArea,
 cropGrid,
 cropShape,
 initialCropView,
 isAnimatedImage,
 openErrorMessage,
 previewMaxSide,
 previewSize,
 zoomPercent
} from './image-crop-dialog-rules.ts';

test('кадр аватара квадратный, обложки — 3:1 с сеткой', () => {
 assert.equal(cropAspect('avatar'), 1);
 assert.equal(cropAspect('cover'), 3);
 assert.equal(cropShape('avatar'), 'round');
 assert.equal(cropShape('cover'), 'rect');
 assert.equal(cropGrid('cover'), true);
 assert.equal(cropGrid('avatar'), false);
});

test('большое изображение уменьшается до 2048 px по длинной стороне', () => {
 assert.deepEqual(previewSize(4096, 2048), {width: previewMaxSide, height: 1024});
 assert.deepEqual(previewSize(1000, 500), {width: 1000, height: 500}, 'маленькое не трогаем');
 assert.deepEqual(previewSize(3000, 3000), {width: 2048, height: 2048});
 assert.equal(previewSize(1, 4000).width, 1, 'сторона не должна стать нулевой');
});

test('округление не ломает пропорции сильнее полпроцента', () => {
 const size = previewSize(4097, 3);
 assert.equal(size.height, 3, 'крошечная сторона сохраняет исходные размеры');
});

test('кадр из области и сброс вида', () => {
 assert.deepEqual(cropFromArea({x: 10, y: 20, width: 30, height: 40}), {x: 10, y: 20, width: 30, height: 40});
 assert.deepEqual(initialCropView(), {position: {x: 0, y: 0}, zoom: 1, crop: null});
});

test('сохранять можно только с картинкой, кадром и без работы', () => {
 const crop = {x: 0, y: 0, width: 100, height: 100};
 assert.equal(canApplyCrop('blob:x', crop, false), true);
 assert.equal(canApplyCrop('', crop, false), false);
 assert.equal(canApplyCrop('blob:x', null, false), false);
 assert.equal(canApplyCrop('blob:x', crop, true), false);
});

test('масштаб показывается в процентах, GIF остаётся анимацией', () => {
 assert.equal(zoomPercent(1), '100%');
 assert.equal(zoomPercent(2.345), '235%');
 assert.equal(isAnimatedImage({mime: 'image/gif'}), true);
 assert.equal(isAnimatedImage({mime: 'image/png'}), false);
 assert.equal(isAnimatedImage(null), false);
});

test('тексты ошибок открытия и сохранения', () => {
 assert.equal(openErrorMessage(new Error('Повреждённое изображение')), 'Повреждённое изображение');
 assert.equal(openErrorMessage('что-то'), 'Не удалось открыть изображение');
 assert.equal(applyErrorMessage(new Error('Слишком большой файл')), 'Слишком большой файл');
 assert.equal(applyErrorMessage(undefined), 'Не удалось сохранить изображение');
});
