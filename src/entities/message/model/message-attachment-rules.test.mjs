// Правила вложений: доступность, безопасное имя, ключи предпросмотра и тело из base64.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
 attachmentAvailable,
 attachmentBlob,
 attachmentIdentity,
 cacheNote,
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
