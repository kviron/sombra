import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectImage, validateCrop, bytesDataUrl, readImageSource} from './image-crop.ts';
function makeWebp(lossless = false) {
 const bytes = new Uint8Array(lossless ? 44 : 48),
  v = new DataView(bytes.buffer),
  text = new TextEncoder();
 bytes.set(text.encode('RIFF'));
 v.setUint32(4, bytes.length - 8, true);
 bytes.set(text.encode('WEBPVP8X'), 8);
 v.setUint32(16, 10, true);
 bytes[24] = 11;
 bytes[27] = 3;
 bytes.set(text.encode(lossless ? 'VP8L' : 'VP8 '), 30);
 v.setUint32(34, lossless ? 5 : 10, true);
 if (lossless) {
  bytes[38] = 47;
  v.setUint32(39, 11 | (3 << 14), true);
 } else {
  bytes.set([157, 1, 42], 41);
  v.setUint16(44, 12, true);
  v.setUint16(46, 4, true);
 }
 return bytes;
}
const gif = Uint8Array.from(Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64'));
test('GIF headers validate and original bytes remain exact', () => {
 assert.deepEqual(inspectImage(gif, 'image/gif', 'cover'), {width: 1, height: 1, mime: 'image/gif', frames: 1});
 assert.deepEqual(Buffer.from(bytesDataUrl(gif, 'image/gif').split(',')[1], 'base64'), Buffer.from(gif));
});
test('GIF avatar explicitly rejects animation', () =>
 assert.throws(() => inspectImage(gif, 'image/gif', 'avatar'), /статическое/));
test('GIF malformed trailer, truncation and huge logical canvas reject before decoder', () => {
 for (const bytes of [gif.subarray(0, gif.length - 1), Uint8Array.from([...gif, 0])])
  assert.throws(() => inspectImage(bytes, 'image/gif', 'cover'));
 const bomb = gif.slice();
 bomb[6] = 255;
 bomb[7] = 255;
 assert.throws(() => inspectImage(bomb, 'image/gif', 'cover'));
});
test('GIF complexity cap stops frame storms', () => {
 const head = gif.subarray(0, 19),
  frame = gif.subarray(19, gif.length - 1);
 const bytes = Uint8Array.from([...head, ...Array.from({length: 241}, () => Array.from(frame)).flat(), 59]);
 assert.throws(() => inspectImage(bytes, 'image/gif', 'cover'), /240/);
});
test('strict MIME rejects spoofed and active image content', () => {
 for (const mime of ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'text/html'])
  assert.throws(() => inspectImage(gif, mime, 'cover'));
 assert.throws(() => inspectImage(new TextEncoder().encode('<svg/>'), 'image/png', 'cover'));
});
test('crop bounds, finite numbers and target aspect checked', () => {
 assert.deepEqual(validateCrop({x: 0, y: 25, width: 100, height: 50}, 1200, 800, 3), {
  x: 0,
  y: 25,
  width: 100,
  height: 50
 });
 for (const crop of [
  {x: NaN, y: 0, width: 100, height: 100},
  {x: -1, y: 0, width: 100, height: 100},
  {x: 1, y: 0, width: 100, height: 100},
  {x: 0, y: 0, width: 0, height: 100},
  {x: 0, y: 0, width: 100, height: 100}
 ])
  assert.throws(() => validateCrop(crop, 1200, 800, 3));
});
test('oversized source rejected before parsing', () =>
 assert.throws(() => inspectImage(new Uint8Array(20 * 1024 * 1024 + 1), 'image/png', 'cover'), /20/));
test('file byte reads never start for oversized GIF/static or unsupported MIME', async () => {
 for (const [size, type, kind] of [
  [20 * 1024 * 1024 + 1, 'image/png', 'cover'],
  [2 * 1024 * 1024 + 1, 'image/gif', 'cover'],
  [10, 'image/gif', 'avatar'],
  [10, 'text/html', 'cover']
 ]) {
  let read = false;
  await assert.rejects(
   readImageSource(
    {
     size,
     type,
     arrayBuffer() {
      read = true;
      throw new Error('must not read');
     }
    },
    kind
   )
  );
  assert.equal(read, false);
 }
});
test('JPEG EXIF orientations 1..8 use displayed dimensions, malformed offsets stay bounded', () => {
 const make = (orientation, little = true) => {
  const exif = new Uint8Array(32);
  exif.set([69, 120, 105, 102, 0, 0]);
  const v = new DataView(exif.buffer);
  v.setUint16(6, little ? 0x4949 : 0x4d4d);
  v.setUint16(8, 42, little);
  v.setUint32(10, 8, little);
  v.setUint16(14, 1, little);
  v.setUint16(16, 0x112, little);
  v.setUint16(18, 3, little);
  v.setUint32(20, 1, little);
  v.setUint16(24, orientation, little);
  return Uint8Array.from([255, 216, 255, 225, 0, 34, ...exif, 255, 192, 0, 8, 8, 0, 40, 0, 120, 1, 255, 217]);
 };
 for (let orientation = 1; orientation <= 8; orientation++)
  for (const little of [true, false]) {
   const result = inspectImage(make(orientation, little), 'image/jpeg', 'cover');
   assert.equal(result.width, orientation >= 5 ? 40 : 120);
   assert.equal(result.height, orientation >= 5 ? 120 : 40);
  }
 for (const orientation of [0, 9]) assert.throws(() => inspectImage(make(orientation), 'image/jpeg', 'cover'));
 const malicious = make(6);
 new DataView(malicious.buffer).setUint32(16, 0xffffffff, true);
 assert.throws(() => inspectImage(malicious, 'image/jpeg', 'cover'));
});
test('conflicting duplicate PNG/JPEG/WebP size headers reject before decoding', () => {
 const png = Uint8Array.from(
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==', 'base64')
 );
 assert.throws(() =>
  inspectImage(
   Uint8Array.from([...png.subarray(0, 33), ...png.subarray(8, 33), ...png.subarray(33)]),
   'image/png',
   'cover'
  )
 );
 const sof = width => [255, 192, 0, 8, 8, 0, 40, width >>> 8, width & 255, 1];
 assert.throws(() =>
  inspectImage(Uint8Array.from([255, 216, ...sof(16383), ...sof(120), 255, 217]), 'image/jpeg', 'cover')
 );
 for (const lossless of [false, true]) {
  const bytes = makeWebp(lossless);
  assert.equal(inspectImage(bytes, 'image/webp', 'cover').width, 12);
  bytes[24] = 10;
  assert.throws(() => inspectImage(bytes, 'image/webp', 'cover'));
 }
 for (const lossless of [false, true]) {
  const bytes = makeWebp(lossless),
   duplicate = Uint8Array.from([...bytes, ...bytes.subarray(30)]);
  new DataView(duplicate.buffer).setUint32(4, duplicate.length - 8, true);
  assert.throws(() => inspectImage(duplicate, 'image/webp', 'cover'));
 }
 const noImage = makeWebp().subarray(0, 30);
 new DataView(noImage.buffer).setUint32(4, 22, true);
 assert.throws(() => inspectImage(noImage, 'image/webp', 'cover'));
});
test('static dimension headers checked without any browser decode', () => {
 const png = Uint8Array.from(
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==', 'base64')
 );
 assert.equal(inspectImage(png, 'image/png', 'cover').width, 1);
 const bomb = png.slice();
 new DataView(bomb.buffer).setUint32(16, 8193);
 assert.throws(() => inspectImage(bomb, 'image/png', 'cover'), /8192/);
 const webp = makeWebp();
 assert.deepEqual(inspectImage(webp, 'image/webp', 'cover'), {width: 12, height: 4, mime: 'image/webp', frames: 1});
});
