import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chatNavigationActions as navigation, chatNavigationStore} from './chat-navigation.ts';

test('back and forward restore group channels and dialogs without recording duplicate visits', t => {
 t.after(navigation.reset);
 navigation.selectGroup('group');
 navigation.selectChannel('voice');
 navigation.selectChannel('voice');
 navigation.openDialog('dialog');
 navigation.back();
 assert.equal(chatNavigationStore.getState().home, false);
 assert.equal(chatNavigationStore.getState().channelId, 'voice');
 navigation.forward();
 assert.equal(chatNavigationStore.getState().home, true);
 assert.equal(chatNavigationStore.getState().channelId, 'dialog');
 navigation.back();
 navigation.back();
 assert.equal(chatNavigationStore.getState().channelId, '');
 navigation.selectChannel('text');
 assert.deepEqual(chatNavigationStore.getState().next, []);
});

test('deleted channels and left groups cannot be reopened from history', t => {
 t.after(navigation.reset);
 navigation.openGroup('group', 'deleted');
 navigation.openGroup('group', 'voice');
 navigation.openDialog('dialog');
 navigation.clearChannel('deleted');
 navigation.back();
 assert.equal(chatNavigationStore.getState().channelId, 'voice');
 navigation.leaveGroupScope('group');
 assert.equal(chatNavigationStore.getState().home, true);
 assert.ok(chatNavigationStore.getState().previous.every(entry => entry.home));
 navigation.forward();
 assert.equal(chatNavigationStore.getState().channelId, 'dialog');
});
