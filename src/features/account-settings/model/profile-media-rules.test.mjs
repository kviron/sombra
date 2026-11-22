// Правила диалога медиа профиля: подписи цели, наличие картинки и текст результата.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
 decorationNotice,
 mediaDescription,
 mediaFrame,
 mediaHasImage,
 mediaTitle,
 removeNotice
} from './profile-media-rules.ts';

const user = {
 avatar: 'data:image/png;base64,avatar',
 cover: '',
 decorations: {avatar: {mode: 'frame', seed: 1}}
};

test('у аватара и обложки свои заголовок и описание', () => {
 assert.equal(mediaTitle('avatar'), 'Аватар профиля');
 assert.equal(mediaTitle('cover'), 'Обложка профиля');
 assert.equal(mediaDescription('avatar'), 'Квадратная картинка и рамка вокруг неё.');
 assert.equal(mediaDescription('cover'), 'Широкая картинка за аватаром и анимация поверх неё.');
});

test('наличие картинки проверяется по своей цели', () => {
 assert.equal(mediaHasImage(user, 'avatar'), true);
 assert.equal(mediaHasImage(user, 'cover'), false);
 assert.equal(mediaHasImage({avatar: '', cover: 'data:image/png;base64,cover'}, 'cover'), true);
});

test('рамка берётся из украшений цели, иначе её нет', () => {
 assert.deepEqual(mediaFrame(user, 'avatar'), {mode: 'frame', seed: 1});
 assert.equal(mediaFrame(user, 'cover'), null);
 assert.equal(mediaFrame({}, 'avatar'), null);
});

test('после сохранения и удаления показывается подпись своей цели', () => {
 assert.equal(decorationNotice('avatar', {mode: 'frame'}), 'Рамка обновлена');
 assert.equal(decorationNotice('avatar', null), 'Рамка убрана');
 assert.equal(decorationNotice('cover', {mode: 'scene'}), 'Анимация обновлена');
 assert.equal(decorationNotice('cover', null), 'Анимация убрана');
 assert.equal(removeNotice('avatar'), 'Аватар удалён');
 assert.equal(removeNotice('cover'), 'Обложка удалена');
});
