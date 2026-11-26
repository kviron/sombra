import {test} from 'node:test';
import assert from 'node:assert/strict';
import {attachmentSelectionError, draftImageMime, MAX_ATTACHMENT_SIZE} from './draft-attachments.ts';

test('лимиты включают выбранные ранее файлы и допускают ровно 10 МиБ на файл', () => {
 const file = {name: 'document.pdf', size: MAX_ATTACHMENT_SIZE};
 assert.equal(attachmentSelectionError(8, [file, file]), '');
 assert.match(attachmentSelectionError(9, [file, file]), /10 файлов/);
 assert.match(attachmentSelectionError(0, [file, {...file, size: file.size + 1}]), /document\.pdf.*10 МиБ/);
});

test('превью разрешено только для известных растровых сигнатур', () => {
 const ascii = value => new TextEncoder().encode(value);
 assert.equal(draftImageMime(ascii('GIF89a')), 'image/gif');
 assert.equal(draftImageMime(ascii('GIF87a')), 'image/gif');
 assert.equal(draftImageMime(ascii('RIFF0000WEBP')), 'image/webp');
 assert.equal(draftImageMime(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])), 'image/png');
 assert.equal(draftImageMime(Uint8Array.from([255, 216, 255])), 'image/jpeg');
 for (const other of ['GIF89', 'RIFF0000WAVE', '<svg', '<html>']) assert.equal(draftImageMime(ascii(other)), undefined);
});
