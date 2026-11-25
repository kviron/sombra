import assert from 'node:assert/strict';
import test from 'node:test';
import {stickerLibraryIds} from './sticker-cache-access.ts';

test('durable sticker thumbnails require a current library grant', () => {
 const stickers = [
  {id: 'mine', owner: 'me'},
  {id: 'installed', owner: 'other', packInstalled: true},
  {id: 'history', owner: 'other'},
  {id: 'group', owner: 'other', group: 'allowed'},
  {id: 'former', owner: 'me', group: 'former'},
  {id: 'archived', owner: 'me', archived: true}
 ];
 const state = {me: {id: 'me'}, groups: [{id: 'allowed', members: ['me']}], stickers};
 assert.deepEqual([...stickerLibraryIds(state)], ['mine', 'installed', 'group']);
 assert.deepEqual([...stickerLibraryIds({...state, groups: []})], ['mine', 'installed']);
 assert.deepEqual([...stickerLibraryIds({...state, me: {id: 'outsider'}})], ['installed']);
});
