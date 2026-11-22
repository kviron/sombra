// The transport monitor turns WebRTC stats into journal categories. These tests pin the
// silence heuristic, including the path where the engine reports energy but no audioLevel.
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
    ['out', outbound],
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
  const monitor = createVoiceTransportMonitor((category) => events.push(category));
  monitor.sample(report({packetsSent: 1, audioLevel: 0.2}), sendOnly, 1000);
  assert.deepEqual(events, ['path_direct']);
});

test('a relay candidate on either side is a relay path, not a direct one', () => {
  const events = [];
  const monitor = createVoiceTransportMonitor((category) => events.push(category));
  monitor.sample(report({packetsSent: 1, audioLevel: 0.2, candidateType: 'relay'}), sendOnly, 1000);
  assert.deepEqual(events, ['path_relay']);
});

test('silence is reported from audioLevel after three quiet samples', () => {
  const events = [];
  const monitor = createVoiceTransportMonitor((category) => events.push(category));
  for (let i = 0; i < 4; i++) {
    monitor.sample(report({packetsSent: 10 * (i + 1), audioLevel: 0.002}), sendOnly, 1000 * (i + 1));
  }
  assert.ok(events.includes('audio_send_silent'), `expected audio_send_silent, got ${events.join(',')}`);
});

test('silence is reported from flat cumulative energy when audioLevel is missing', () => {
  const events = [];
  const monitor = createVoiceTransportMonitor((category) => events.push(category));
  for (let i = 0; i < 4; i++) {
    monitor.sample(
      report({packetsSent: 10 * (i + 1), withLevel: false, totalAudioEnergy: 5}),
      sendOnly,
      1000 * (i + 1),
    );
  }
  assert.ok(events.includes('audio_send_silent'), `expected audio_send_silent, got ${events.join(',')}`);
});

test('growing energy is speech and never reports silence', () => {
  const events = [];
  const monitor = createVoiceTransportMonitor((category) => events.push(category));
  for (let i = 0; i < 4; i++) {
    monitor.sample(
      report({packetsSent: 10 * (i + 1), withLevel: false, totalAudioEnergy: 5 + i * 0.4}),
      sendOnly,
      1000 * (i + 1),
    );
  }
  assert.equal(events.includes('audio_send_silent'), false);
});

test('speech after silence is reported as recovered', () => {
  const events = [];
  const monitor = createVoiceTransportMonitor((category) => events.push(category));
  for (let i = 0; i < 4; i++) {
    monitor.sample(report({packetsSent: 10 * (i + 1), audioLevel: 0.001}), sendOnly, 1000 * (i + 1));
  }
  monitor.sample(report({packetsSent: 50, audioLevel: 0.3}), sendOnly, 5000);
  assert.ok(events.includes('audio_send_silent'));
  assert.ok(events.includes('audio_send_silent_recovered'));
});

test('packets that stop advancing are a send stall, not silence', () => {
  const events = [];
  const monitor = createVoiceTransportMonitor((category) => events.push(category));
  monitor.sample(report({packetsSent: 10, audioLevel: 0.2}), sendOnly, 1000);
  monitor.sample(report({packetsSent: 20, audioLevel: 0.2}), sendOnly, 2000);
  for (let i = 0; i < 3; i++) {
    monitor.sample(report({packetsSent: 20, audioLevel: 0.2}), sendOnly, 3000 + i * 1000);
  }
  assert.ok(events.includes('audio_send_stalled'), `expected audio_send_stalled, got ${events.join(',')}`);
});

test('receive silence is reported when packets arrive without energy', () => {
  const events = [];
  const monitor = createVoiceTransportMonitor((category) => events.push(category));
  const stats = (packetsReceived, energy) =>
    new Map([
      ['t', {id: 't', type: 'transport', selectedCandidatePairId: 'pair'}],
      ['pair', {id: 'pair', type: 'candidate-pair', state: 'succeeded', localCandidateId: 'l', remoteCandidateId: 'r'}],
      ['l', {id: 'l', type: 'local-candidate', candidateType: 'host'}],
      ['r', {id: 'r', type: 'remote-candidate', candidateType: 'host'}],
      ['in', {id: 'in', type: 'inbound-rtp', kind: 'audio', transportId: 't', packetsReceived, totalAudioEnergy: energy}],
    ]);
  for (let i = 0; i < 4; i++) {
    monitor.sample(stats(10 * (i + 1), 5), {send: false, receive: true}, 1000 * (i + 1));
  }
  assert.ok(events.includes('audio_receive_silent'), 'expected audio_receive_silent, got ' + events.join(','));
});
