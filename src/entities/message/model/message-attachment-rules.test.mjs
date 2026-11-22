// Правила вложений: доступность, безопасное имя, ключи предпросмотра и тело из base64.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
 attachmentActionLabels,
 attachmentAvailable,
 attachmentBlob,
 attachmentCopyError,
 attachmentIdentity,
 attachmentMenuItems,
 cacheNote,
 canCopyAttachment,
 canDownloadAttachment,
 isImageMime,
 MAX_ATTACHMENT_BYTES,
 previewScopeId,
 safeAttachmentName
} from './message-attachment-rules.ts';

const attachment = {id: 'a1', name: 'фото.png', size: 5, mime: 'image/png'};

test('файл доступен, пока жива локальная копия', () => {
 assert.equal(attachmentAvailable({}), true);
 assert.equal(attachmentAvailable({expired: true}), false);
 assert.equal(attachmentAvailable({expired: true, cached: true}), true);
});

test('картинками считаются только растровые MIME', () => {
 assert.equal(isImageMime('image/png'), true);
 assert.equal(isImageMime('image/gif'), true);
 assert.equal(isImageMime('image/svg+xml'), false);
 assert.equal(isImageMime('application/pdf'), false);
});

test('имя для скачивания очищается и не бывает пустым', () => {
 assert.equal(safeAttachmentName('отчёт:2026/год?.pdf'), 'отчёт_2026_год_.pdf');
 assert.equal(safeAttachmentName('a\u0000b.png'), 'a_b.png');
 assert.equal(safeAttachmentName(''), 'Вложение');
 assert.equal(safeAttachmentName('x'.repeat(300)).length, 240);
});

test('подпись локальной копии зависит от очистки на сервере', () => {
 assert.equal(cacheNote({}), 'Сохранено на этом устройстве');
 assert.equal(cacheNote({expired: true}), 'Локальная копия · файл очищен на сервере');
});

test('ключи вложения и области предпросмотра различают файл и вид', () => {
 const scope = previewScopeId('token', 2, 3);
 const base = attachmentIdentity(scope, 'm1', attachment);
 assert.notEqual(base, attachmentIdentity(previewScopeId('token', 2, 4), 'm1', attachment));
 assert.notEqual(base, attachmentIdentity(scope, 'm2', attachment));
 assert.notEqual(base, attachmentIdentity(scope, 'm1', {...attachment, size: 6}));
 assert.notEqual(base, attachmentIdentity(scope, 'm1', attachment, 'audio'));
 assert.equal(base, attachmentIdentity(scope, 'm1', attachment));
});

test('тело вложения декодируется и получает безопасный MIME', () => {
 const blob = attachmentBlob({data: btoa('hello'), mime: 'image/png', name: 'a.png'});
 assert.equal(blob.type, 'image/png');
 assert.equal(blob.size, 5);
 const other = attachmentBlob({data: btoa('hello'), mime: 'image/svg+xml', name: 'a.svg'});
 assert.equal(other.type, 'application/octet-stream');
});

test('слишком большое или битое тело вложения отклоняется', () => {
 assert.throws(
  () => attachmentBlob({data: 'x'.repeat(Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4 + 4), mime: 'image/png', name: 'a'}),
  /Некорректный размер вложения/
 );
 assert.throws(() => attachmentBlob({data: undefined, mime: 'image/png', name: 'a'}), /Некорректный размер вложения/);
});

test('меню картинки: два пункта, «Скопировать» ждёт загрузки предпросмотра', () => {
 const items = attachmentMenuItems({available: true, mime: 'image/png', loaded: true, name: 'фото.png'});
 assert.deepEqual(
  items.map(item => [item.id, item.label, item.disabled, item.title]),
  [
   ['copy', 'Скопировать', false, 'Скопировать изображение в буфер обмена'],
   ['download', 'Скачать', false, 'Сохранить фото.png']
  ]
 );
 assert.equal(attachmentActionLabels.copy, 'Скопировать');
 assert.equal(attachmentActionLabels.download, 'Скачать');

 const pending = attachmentMenuItems({available: true, mime: 'image/jpeg', loaded: false, name: 'фото.jpg'});
 assert.equal(pending[0].disabled, true);
 assert.equal(pending[0].title, 'Изображение ещё не загружено');
 assert.equal(pending[1].disabled, false);
 assert.equal(attachmentMenuItems({available: true, mime: 'image/png', loaded: true})[1].title, 'Сохранить Вложение');
});

test('«Скопировать» недоступно для нерастровых и удалённых файлов, «Скачать» — только для доступных', () => {
 const vector = attachmentMenuItems({available: true, mime: 'image/svg+xml', loaded: true, name: 'иконка.svg'});
 assert.equal(vector[0].disabled, true);
 assert.equal(vector[0].title, 'Этот файл нельзя скопировать как изображение');

 const expired = attachmentMenuItems({available: false, mime: 'image/png', loaded: false, name: 'фото.png'});
 assert.deepEqual(
  expired.map(item => [item.disabled, item.title]),
  [
   [true, 'Файл больше недоступен'],
   [true, 'Файл больше недоступен']
  ]
 );
});

test('идущее копирование и сохранение блокируют повторный запуск', () => {
 const busy = attachmentMenuItems({available: true, mime: 'image/png', loaded: true, copying: true, saving: true});
 assert.deepEqual(
  busy.map(item => [item.disabled, item.title]),
  [
   [true, 'Изображение уже копируется'],
   [true, 'Файл уже сохраняется']
  ]
 );
 assert.equal(canCopyAttachment({available: true, mime: 'image/png', loaded: true}), true);
 assert.equal(canCopyAttachment({available: true, mime: 'image/png', loaded: true, copying: true}), false);
 assert.equal(canCopyAttachment({available: true, mime: 'image/webp', loaded: false}), false);
 assert.equal(canDownloadAttachment({available: true}), true);
 assert.equal(canDownloadAttachment({available: true, saving: true}), false);
 assert.equal(canDownloadAttachment({available: false}), false);
});

test('ошибка копирования одна и понятна пользователю', () => {
 assert.equal(attachmentCopyError, 'Браузер не разрешил скопировать изображение');
 assert.match(attachmentCopyError, /не разрешил/);
});
