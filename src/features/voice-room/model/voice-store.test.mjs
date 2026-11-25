import test from 'node:test';
import assert from 'node:assert/strict';
import {createVoiceStore} from './voice-store.ts';
import {
 selectRoomParticipants,
 selectVoiceAvailability,
 selectVoiceChannelMembers,
 selectVoicePeers,
 selectVoiceView
} from './voice-selectors.ts';

const preferences = {mic: '', camera: '', speaker: '', volume: 100, echo: true, noise: 'standard', relay: false};

test('voice sessions own their state and peer collections independently', () => {
 const first = createVoiceStore(preferences),
  second = createVoiceStore(preferences);
 first.setState({room: 'one', peers: [{client: 'peer', user: 'user'}], availability: {muted: true, deaf: false}});
 assert.equal(selectVoiceView(first.getState()).room, 'one');
 assert.equal(selectVoiceView(first.getState()).muted, true);
 assert.equal(selectVoiceView(second.getState()).room, '');
 assert.deepEqual(selectVoicePeers(second.getState()), []);
 assert.equal(selectVoiceView(second.getState()).muted, false);
});

test('unrelated voice updates preserve peer and availability selector references', () => {
 const store = createVoiceStore(preferences);
 const peers = selectVoicePeers(store.getState()),
  availability = selectVoiceAvailability(store.getState());
 store.setState({error: 'Device unavailable', busy: true});
 assert.equal(selectVoicePeers(store.getState()), peers);
 assert.equal(selectVoiceAvailability(store.getState()), availability);
 assert.equal(selectVoiceView(store.getState()).error, 'Device unavailable');
 assert.equal(selectVoiceView(store.getState()).busy, true);
});

test('resetting a call clears live state atomically and preserves user preferences', () => {
 const store = createVoiceStore(preferences),
  {actions} = store.getState();
 const local = {id: 'local'};
 actions.setPreferences({...preferences, speaker: 'headset'});
 actions.setAvailability({muted: true, deaf: false});
 actions.connected('room', local, true, [{client: 'other', user: 'user'}], 'self');
 actions.setRemoteStream('other', {id: 'remote'});
 actions.setConnection('other', 'connected');
 const changes = [];
 store.subscribe(state => changes.push(state));
 actions.resetCall(75);
 assert.equal(changes.length, 1);
 const state = store.getState();
 assert.equal(state.room, '');
 assert.equal(state.local, null);
 assert.equal(state.camera, false);
 assert.equal(state.busy, false);
 assert.equal(state.micVolume, 75);
 assert.deepEqual(state.peers, []);
 assert.deepEqual(state.streams, {});
 assert.deepEqual(state.connections, {});
 assert.equal(state.preferences.speaker, 'headset');
 assert.deepEqual(state.availability, {muted: true, deaf: false});
 assert.equal(state.actions, actions);
 assert.equal('actions' in selectVoiceView(state), false);
});

test('idle peer updates do not notify subscribers; a departed peer is removed', () => {
 const store = createVoiceStore(preferences),
  {actions} = store.getState();
 const own = {client: 'self', user: 'me'},
  peer = {client: 'other', user: 'you'};
 actions.setPeers([own, peer], 'self');
 actions.setRemoteStream('other', {id: 'stream'});
 actions.setConnection('other', 'connected');
 let updates = 0;
 store.subscribe(() => updates++);
 actions.setPeers([{...peer}, own], 'self');
 assert.equal(updates, 0);
 actions.setRemoteStream('other', null);
 actions.setConnection('other', null);
 actions.setPeers([own], 'self');
 assert.deepEqual(store.getState().streams, {});
 assert.deepEqual(store.getState().connections, {});
 assert.deepEqual(store.getState().peers, []);
});

test('a new track event republishes the receiver even when WebRTC reuses the stream object', () => {
 const store = createVoiceStore(preferences),
  {actions} = store.getState();
 const stream = {tracks: ['audio']};
 actions.setRemoteStream('other', stream);
 const previous = store.getState().streams;
 stream.tracks.push('video');
 actions.setRemoteStream('other', stream);
 assert.notEqual(store.getState().streams, previous);
 assert.equal(store.getState().streams.other, stream);
});

test('mic and deafen transitions read the latest state without waiting for a React render', () => {
 const store = createVoiceStore(preferences),
  {actions} = store.getState();
 assert.deepEqual(actions.toggleMic(), {muted: true, deaf: false});
 assert.deepEqual(actions.toggleMic(), {muted: false, deaf: false});
 assert.deepEqual(actions.toggleDeaf(), {muted: false, deaf: true});
 assert.deepEqual(actions.toggleMic(), {muted: false, deaf: false});
 actions.toggleMic();
 actions.toggleDeaf();
 assert.deepEqual(actions.toggleDeaf(), {muted: true, deaf: false});
});

test('viewing a different room shows its presence without claiming a local connection', () => {
 const call = {room: 'one', peers: [{client: 'live', user: 'friend'}], muted: false, deaf: false};
 const presence = [{user: 'me', muted: true, deaf: false}];
 assert.deepEqual(selectRoomParticipants(call, 'two', 'me', presence), [
  {key: 'me', id: 'me', self: false, muted: true, deaf: false}
 ]);
 assert.deepEqual(selectRoomParticipants(call, 'two', 'me'), []);
 assert.deepEqual(
  selectRoomParticipants(call, 'one', 'me', presence).map(p => [p.key, p.self, p.muted]),
  [
   ['self', true, false],
   ['live', false, undefined]
  ]
 );
});

test('the first connected snapshot includes existing participants before the first poll', () => {
 const store = createVoiceStore(preferences);
 const friend = {client: 'remote', user: 'friend', muted: true, deaf: false};
 const participants = [];
 store.subscribe(state => {
  if (state.room === 'team') {
   participants.push(selectRoomParticipants(selectVoiceView(state), 'team', 'me').map(p => p.id));
  }
 });
 store.getState().actions.connected('team', {}, false, [friend, {client: 'local', user: 'me'}], 'local');
 assert.deepEqual(participants, [['me', 'friend']]);
});

test('sidebar keeps existing members across join and avoids duplicating self when chat catches up', () => {
 const friend = {user: 'friend', muted: false, deaf: false};
 const local = {room: '', muted: true, deaf: false};
 const before = selectVoiceChannelMembers(local, 'team', 'me', [friend]);
 const joined = {...local, room: 'team'};
 const during = selectVoiceChannelMembers(joined, 'team', 'me', [friend]);
 assert.deepEqual(during, [...before, {id: 'me', self: true, muted: true, deaf: false}]);
 assert.deepEqual(
  selectVoiceChannelMembers(joined, 'team', 'me', [friend, {user: 'me', muted: false, deaf: false}]),
  during
 );
 assert.deepEqual(selectVoiceChannelMembers(joined, 'team', 'me', []), [during[1]]);
});
