import assert from 'node:assert/strict';
import {test} from 'node:test';
import {attachmentAlbumRows} from './attachment-album.ts';

const photo = (id, width, height = 1000) => ({id, width, height, name: id, mime: 'image/png', size: 20});
const rowIds = rows =>
 rows.map(row => (row.kind === 'file' ? [row.attachment.id] : row.photos.map(p => p.attachment.id)));

test('wide screenshots span separate rows and the two photos below share their height', () => {
 const rows = attachmentAlbumRows([photo('a', 2750), photo('b', 2720), photo('c', 1600), photo('d', 1000)]);
 assert.deepEqual(rowIds(rows), [['a'], ['b'], ['c', 'd']]);
 assert.equal(rows[2].ratio, 2.6);
 assert.equal(rows[2].photos[0].ratio, 1.6);
});

test('two, three and four ordinary photos form balanced rows', () => {
 const photos = ['a', 'b', 'c', 'd'].map(id => photo(id, 1250));
 assert.deepEqual(rowIds(attachmentAlbumRows(photos.slice(0, 2))), [['a', 'b']]);
 assert.deepEqual(rowIds(attachmentAlbumRows(photos.slice(0, 3))), [['a'], ['b', 'c']]);
 assert.deepEqual(rowIds(attachmentAlbumRows(photos)), [
  ['a', 'b'],
  ['c', 'd']
 ]);
});

test('ten mixed attachments keep their order, and a document or audio track ends the photo group', () => {
 const photos = Array.from({length: 10}, (_, i) => photo(String(i), 760));
 assert.deepEqual(
  rowIds(attachmentAlbumRows(photos)).flat(),
  photos.map(p => p.id)
 );
 assert.ok(attachmentAlbumRows(photos).every(row => row.photos.length <= 3));
 photos[3].mime = 'application/pdf';
 photos[5].mime = 'audio/mpeg';
 const rows = attachmentAlbumRows(photos);
 assert.deepEqual(
  rowIds(rows).flat(),
  photos.map(p => p.id)
 );
 assert.deepEqual(
  rows.filter(row => row.kind === 'file').map(row => row.attachment.id),
  ['3', '5']
 );
 assert.ok(rowIds(rows).some(row => row.length === 1 && row[0] === '4'));
});

test('missing dimensions and extreme aspect ratios reserve finite tile sizes before decoding', () => {
 const photos = [photo('old'), photo('bad', 0, Infinity), photo('banner', 90000, 1), photo('strip', 1, 90000)];
 const rows = attachmentAlbumRows(photos);
 const ratios = rows.flatMap(row => row.photos.map(p => p.ratio));
 assert.deepEqual(ratios, [4 / 3, 4 / 3, 3.2, 0.7]);
 assert.ok(rows.every(row => row.ratio >= 1.25 && row.ratio <= 4));
 assert.deepEqual(attachmentAlbumRows([]), []);
});
