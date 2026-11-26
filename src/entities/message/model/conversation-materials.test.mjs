import assert from 'node:assert/strict';
import {test} from 'node:test';
import {conversationMaterials, filterMaterials} from './conversation-materials.ts';

test('материалы включают каждый файл альбома в порядке отправки и не дублируют первый', () => {
 const file = {id: 'a', name: 'same.png', mime: 'image/png', size: 20};
 const second = {...file, id: 'b'};
 const album = {id: 'm', channel: 'chat', text: '', time: 2, attachment: file, attachments: [file, second]};
 const legacy = {id: 'old', channel: 'chat', text: '', time: 1, attachment: {...file, id: 'c'}};
 const items = conversationMaterials([legacy, album, {...album, channel: 'other'}], 'chat');
 assert.deepEqual(
  items.map(item => item.attachment.id),
  ['a', 'b', 'c']
 );
 assert.equal(new Set(items.map(item => item.id)).size, 3);
 assert.equal(filterMaterials(items, 'photos', 'same.png', () => 'Автор').length, 3);
});
