import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createVoiceTransportMonitor, iceIsConnected} from './voice-diagnostics.ts';

function report({packetsSent, audioLevel, totalAudioEnergy, withLevel = true, candidateType = 'host'}) {
 const outbound = {id: 'out', type: 'outbound-rtp', kind: 'audio', transportId: 't', packetsSent};
 if (withLevel) outbound.audioLevel = audioLevel;
 if (totalAudioEnergy !== undefined) outbound.totalAudioEnergy = totalAudioEnergy;
 return new Map([
  ['t', {id: 't', type: 'transport', selectedCandidatePairId: 'pair'}],
  ['pair', {id: 'pair', type: 'candidate-pair', state: 'succeeded', localCandidateId: 'l', remoteCandidateId: 'r'}],
  ['l', {id: 'l', type: 'local-candidate', candidateType}],
  ['r', {id: 'r', type: 'remote-candidate', candidateType}],
  ['out', outbound]
 ]);
}

const sendOnly = {send: true, receive: false};

test('iceIsConnected covers connected and completed', () => {
 assert.equal(iceIsConnected('connected'), true);
 assert.equal(iceIsConnected('completed'), true);
 assert.equal(iceIsConnected('checking'), false);
 assert.equal(iceIsConnected('failed'), false);
});

test('reports a direct media path once the selected pair is host/srflx on both sides', () => {
 const events = [];
 const monitor = createVoiceTransportMonitor(category => events.push(category));
 monitor.sample(report({packetsSent: 1, audioLevel: 0.2}), sendOnly, 1000);
 assert.deepEqual(events, ['path_direct']);
});

test('a relay candidate on either side is a relay path, not a direct one', () => {
 const events = [];
 const monitor = createVoiceTransportMonitor(category => events.push(category));
 monitor.sample(report({packetsSent: 1, audioLevel: 0.2, candidateType: 'relay'}), sendOnly, 1000);
 assert.deepEqual(events, ['path_relay']);
});

test('quiet audio keeps flowing without silence or recovery events', () => {
 const events = [];
 const monitor = createVoiceTransportMonitor(category => events.push(category));
 for (let i = 0; i < 8; i++) {
  monitor.sample(report({packetsSent: i + 1, audioLevel: i === 7 ? 0.2 : 0}), sendOnly, 1000 * (i + 1));
 }
 assert.deepEqual(events, ['path_direct']);
});

test('packets that stop advancing are a send stall, not silence', () => {
 const events = [];
 const monitor = createVoiceTransportMonitor(category => events.push(category));
 monitor.sample(report({packetsSent: 10, audioLevel: 0.2}), sendOnly, 1000);
 monitor.sample(report({packetsSent: 20, audioLevel: 0.2}), sendOnly, 2000);
 for (let i = 0; i < 3; i++) {
  monitor.sample(report({packetsSent: 20, audioLevel: 0.2}), sendOnly, 3000 + i * 1000);
 }
 assert.ok(events.includes('audio_send_stalled'), `expected audio_send_stalled, got ${events.join(',')}`);
});

test('incoming packets carrying silence are healthy', () => {
 const events = [];
 const monitor = createVoiceTransportMonitor(category => events.push(category));
 const stats = (packetsReceived, energy) =>
  new Map([
   ['t', {id: 't', type: 'transport', selectedCandidatePairId: 'pair'}],
   ['pair', {id: 'pair', type: 'candidate-pair', state: 'succeeded', localCandidateId: 'l', remoteCandidateId: 'r'}],
   ['l', {id: 'l', type: 'local-candidate', candidateType: 'host'}],
   ['r', {id: 'r', type: 'remote-candidate', candidateType: 'host'}],
   ['in', {id: 'in', type: 'inbound-rtp', kind: 'audio', transportId: 't', packetsReceived, totalAudioEnergy: energy}]
  ]);
 for (let i = 0; i < 4; i++) {
  monitor.sample(stats(10 * (i + 1), 5), {send: false, receive: true}, 1000 * (i + 1));
 }
 assert.deepEqual(events, ['path_direct']);
});
