import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readVoiceInvitation, voiceInvitationText} from './voice-invitation-rules.ts';

test('a voice invitation targets one group and channel', () => {
 const text = voiceInvitationText('group-1', 'room_2');
 assert.deepEqual(readVoiceInvitation(text), {group: 'group-1', channel: 'room_2'});
 assert.equal(readVoiceInvitation(`${text}\n`), null);
 assert.equal(readVoiceInvitation(`Привет! ${text}`), null);
 assert.throws(() => voiceInvitationText('group/other', 'room'));
 assert.throws(() => voiceInvitationText('group', '../room'));
});
