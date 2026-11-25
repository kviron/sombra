import assert from 'node:assert/strict';
import test from 'node:test';
import {reconcileVoicePeers} from './voice-peers.ts';

test('idle voice polls keep the same list without exposing our own client', () => {
 const own = {client: 'local', user: 'self'};
 const peer = {client: 'remote', user: 'other', muted: false, deaf: false};
 const previous = [peer];
 assert.equal(reconcileVoicePeers(previous, [own, {...peer}], own.client), previous);
 assert.deepEqual(reconcileVoicePeers(previous, [own], own.client), []);
 for (const change of [{muted: true}, {deaf: true}, {client: 'rejoined'}, {user: 'changed'}]) {
  const next = {...peer, ...change};
  assert.deepEqual(reconcileVoicePeers(previous, [next, own], own.client), [next]);
 }
});
