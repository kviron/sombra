import test from 'node:test';
import assert from 'node:assert/strict';
import {fileIconKind, fileLabel, formatFileSize} from './file-data.ts';
test('mime selects the upstream file icon kind', () => {
 const cases = [
  ['image/png', 'image'],
  ['application/pdf', 'pdf'],
  ['application/json', 'json'],
  ['text/markdown', 'text'],
  ['audio/mpeg', 'audio'],
  ['video/mp4', 'video'],
  ['application/zip', 'file'],
  ['application/octet-stream', 'file'],
  ['APPLICATION/PDF', 'pdf'],
  ['', 'file']
 ];
 for (const [mime, kind] of cases) assert.equal(fileIconKind(mime), kind, mime);
});
test('file label is a readable fallback, never a path or URL', () => {
 assert.equal(fileLabel('application/pdf'), 'PDF-файл');
 assert.equal(fileLabel('text/plain'), 'Текстовый файл');
 assert.equal(fileLabel('application/octet-stream'), 'Файл');
 assert.equal(fileLabel(''), 'Файл');
 assert.equal(fileLabel('application/zip'), 'ZIP-файл');
});
test('size formatting uses binary Sombra units and rejects broken input', () => {
 assert.equal(formatFileSize(0), '0 Б');
 assert.equal(formatFileSize(1023), '1023 Б');
 assert.equal(formatFileSize(1024), '1.0 КиБ');
 assert.equal(formatFileSize(1536), '1.5 КиБ');
 assert.equal(formatFileSize(10 * 1024 * 1024), '10.0 МиБ');
 assert.equal(formatFileSize(Number.NaN), '—');
 assert.equal(formatFileSize(-1), '—');
});
