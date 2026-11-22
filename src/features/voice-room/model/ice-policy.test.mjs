// Relay policy: with TURN handed out, media can be forced through the server like Discord does.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hasRelay, iceTransportPolicy} from './ice-policy.ts';

const turn = [
 {urls: 'stun:sombra.mi-nerva.ru:3478'},
 {urls: ['turn:sombra.mi-nerva.ru:3478?transport=udp'], username: 'u', credential: 'c'}
];

test('a turn entry is a relay', () => {
 assert.equal(hasRelay(turn), true);
});

test('stun alone is not a relay', () => {
 assert.equal(hasRelay([{urls: 'stun:sombra.mi-nerva.ru:3478'}]), false);
 assert.equal(hasRelay([]), false);
 assert.equal(hasRelay(undefined), false);
});

test('turns counts as a relay too', () => {
 assert.equal(hasRelay([{urls: 'turns:example.org:5349'}]), true);
});

test('relay is requested only when the server offers TURN and the option is on', () => {
 assert.equal(iceTransportPolicy(turn, true), 'relay');
 assert.equal(iceTransportPolicy(turn, false), 'all');
 assert.equal(iceTransportPolicy([{urls: 'stun:example.org'}], true), 'all');
 assert.equal(iceTransportPolicy(undefined, true), 'all');
});
