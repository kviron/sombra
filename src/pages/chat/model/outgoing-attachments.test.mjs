import {test} from 'node:test';
import assert from 'node:assert/strict';
import {stageAttachments, matchesAlbum} from './outgoing-attachments.ts';

test('после сбоя сохраняются подтверждённые id, повтор публикует тот же упорядоченный набор', async () => {
 const files = ['photo', 'audio', 'pdf'];
 const uploads = [];
 let staged = [],
  fail = true,
  inFlight = false;
 const upload = async file => {
  assert.equal(inFlight, false, 'base64 двух файлов не должны находиться в запросах одновременно');
  inFlight = true;
  uploads.push(file);
  await new Promise(resolve => setImmediate(resolve));
  inFlight = false;
  if (file === 'audio' && fail) throw Error('network');
  return 'id-' + file;
 };
 const stage = () =>
  stageAttachments(files, staged, upload, ids => {
   staged = ids;
  });
 await assert.rejects(stage(), /network/);
 assert.deepEqual(staged, ['id-photo']);
 fail = false;
 assert.deepEqual(await stage(), ['id-photo', 'id-audio', 'id-pdf']);
 assert.deepEqual(await stage(), staged, 'потерянный ответ публикации не вызывает загрузки');
 assert.deepEqual(uploads, ['photo', 'audio', 'audio', 'pdf']);
 assert.equal(matchesAlbum(staged, 3, {attachments: staged.map(id => ({id}))}), true);
 assert.equal(matchesAlbum(staged, 3, {attachments: staged.toReversed().map(id => ({id}))}), false);
 assert.equal(matchesAlbum(staged.slice(0, 1), 3, {}), false);
});

test('неподтверждённая загрузка не превращается в пустой id альбома', async () => {
 await assert.rejects(
  stageAttachments(
   ['one'],
   [],
   async () => '',
   () => assert.fail()
  ),
  /не подтвердил/
 );
});
