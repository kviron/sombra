import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPeerLink, peerConfiguration} from './peer-signaling.ts';

function fixture(t, ownClient = 'z', deliver = () => {}) {
 const connections = [],
  signals = [],
  errors = [];
 class Connection {
  constructor() {
   connections.push(this);
  }
  connectionState = 'new';
  signalingState = 'stable';
  received = [];
  addTransceiver() {}
  getTransceivers() {
   return [];
  }
  close() {
   this.signalingState = 'closed';
  }
  async setRemoteDescription(description) {
   this.remoteDescription = description;
   this.signalingState = description.type === 'answer' ? 'stable' : 'have-remote-offer';
  }
  async setLocalDescription() {
   this.localDescription = {type: this.signalingState === 'have-remote-offer' ? 'answer' : 'offer'};
   this.signalingState = this.localDescription.type === 'offer' ? 'have-local-offer' : 'stable';
   this.onicecandidate({candidate: {toJSON: () => ({candidate: 'local'})}});
  }
  setConfiguration(config) {
   this.configuration = config;
  }
  restartIce() {
   this.restarted = true;
  }
  async addIceCandidate(candidate) {
   if (candidate.usernameFragment === 'old') throw new DOMException('Obsolete ICE generation', 'OperationError');
   this.received.push(candidate);
  }
  change(state) {
   this.connectionState = state;
   this.onconnectionstatechange();
  }
 }
 const original = [globalThis.RTCPeerConnection, globalThis.MediaStream];
 globalThis.RTCPeerConnection = Connection;
 globalThis.MediaStream = class {};
 t.after(() => {
  [globalThis.RTCPeerConnection, globalThis.MediaStream] = original;
 });
 const link = createPeerLink(ownClient, 'm', {
  iceServers: [],
  preferRelay: () => false,
  retryableSignalError: error => error.message === 'lost ack',
  stream: {getTracks: () => [], getAudioTracks: () => [{}], getVideoTracks: () => []},
  signal: async (_, payload) => {
   signals.push(payload);
   await deliver(payload);
  },
  onConnection() {},
  onStream() {},
  watch() {},
  forget() {},
  onSignalError: error => errors.push(error)
 });
 t.after(() => link.close());
 return {link, connections, signals, errors};
}

const offer = connectionId => ({description: {type: 'offer'}, connectionId});
const fresh = {candidate: 'new'};
const old = {usernameFragment: 'old'};

test('STUN and TURN configuration preserves credentials and honours the relay preference', () => {
 const servers = [{urls: ['stun:example.org', 'turns:example.org'], username: 'u', credential: 'c'}];
 assert.deepEqual(peerConfiguration(servers, true), {iceServers: servers, iceTransportPolicy: 'relay'});
 assert.equal(peerConfiguration([{urls: 'turn:example.org'}], true).iceTransportPolicy, 'relay');
 assert.equal(peerConfiguration(servers, false).iceTransportPolicy, 'all');
 assert.equal(peerConfiguration([{urls: 'stun:example.org'}], true).iceTransportPolicy, 'all');
 assert.equal(peerConfiguration(undefined, true).iceTransportPolicy, 'all');
});

test('early ICE waits for SDP and stale candidates cannot reach a replacement connection', async t => {
 const {link, connections, signals, errors} = fixture(t);
 await link.receive({candidate: old});
 await link.receive({candidate: {candidate: 'stale'}, connectionId: 'retired'});
 await link.receive({candidate: fresh});
 assert.equal(connections.length, 0);
 await link.receive(offer('one'));
 assert.deepEqual(connections[0].received, [fresh]);
 assert.deepEqual(signals, [
  {description: {type: 'answer'}, connectionId: 'one', iceVersion: 2},
  {candidate: {candidate: 'local'}, connectionId: 'one'}
 ]);
 await link.receive(offer('two'));
 await link.receive({connectionId: 'one', candidate: fresh});
 assert.deepEqual(connections[1].received, []);
 await link.receive({candidate: fresh});
 assert.deepEqual(connections[1].received, [fresh]);
 assert.deepEqual(errors, []);
});

test('a peer rejecting its configuration cannot retry on every poll forever', async t => {
 const {link, errors} = fixture(t, 'a');
 globalThis.RTCPeerConnection = class {
  constructor() {
   throw new TypeError('Invalid ICE configuration');
  }
 };
 for (let poll = 0; poll < 10; poll++) await link.offer();
 assert.equal(errors.length, 4);
});

test('candidate-only peer cannot open a connection after leaving', async t => {
 const {link, connections} = fixture(t);
 await link.receive({candidate: fresh});
 link.close();
 await link.receive(offer('late'));
 assert.equal(connections.length, 0);
});

test('missing answer retries one peer; only the current answer ends the wait', async t => {
 t.mock.timers.enable({apis: ['setTimeout']});
 const {link, connections, signals, errors} = fixture(t, 'a');
 await link.offer();
 const oldId = signals[0].connectionId;
 t.mock.timers.tick(20000);
 assert.equal(connections[0].signalingState, 'closed');
 await link.offer();
 const newId = signals.findLast(s => s.description).connectionId;
 const answer = connectionId => ({description: {type: 'answer'}, connectionId});
 await link.receive(answer(oldId));
 assert.equal(connections[1].remoteDescription, undefined);
 await link.receive(answer(newId));
 t.mock.timers.tick(20000);
 await link.offer();
 assert.equal(connections.length, 2);
 assert.equal(connections[1].signalingState, 'stable');
 assert.deepEqual(errors, []);
});

test('unanswered offers exhaust the retry budget and report the failure once', async t => {
 t.mock.timers.enable({apis: ['setTimeout']});
 const {link, connections, errors} = fixture(t, 'a');
 for (let poll = 0; poll < 7; poll++) {
  await link.offer();
  t.mock.timers.tick(20000);
 }
 assert.equal(connections.length, 4);
 assert.equal(errors.length, 1);
});

test('unexpected ICE errors surface and recovery requests share one timer per connection', async t => {
 t.mock.timers.enable({apis: ['setTimeout']});
 const {link, connections, signals, errors} = fixture(t);
 await link.receive(offer('one'));
 const pc = connections[0];
 const error = new TypeError('Invalid candidate');
 pc.addIceCandidate = async () => {
  throw error;
 };
 await link.receive({candidate: fresh});
 assert.deepEqual(errors, [error]);
 pc.change('disconnected');
 pc.change('failed');
 t.mock.timers.tick(1500);
 pc.change('connected');
 t.mock.timers.tick(10000);
 assert.equal(signals.filter(s => s.restart).length, 2);
});

test('disconnected then failed does not leave an older recovery timer running', async t => {
 t.mock.timers.enable({apis: ['setTimeout']});
 const {link, connections, signals} = fixture(t);
 await link.receive(offer('one'));
 connections[0].change('disconnected');
 connections[0].change('failed');
 t.mock.timers.tick(1500);
 t.mock.timers.tick(4000);
 t.mock.timers.tick(2500);
 assert.equal(signals.filter(s => s.restart).length, 2);
});

test('updated peers batch candidate bursts in order; a retired batch cannot escape', async t => {
 t.mock.timers.enable({apis: ['setTimeout']});
 const {link, connections, signals} = fixture(t);
 await link.receive({...offer('one'), iceVersion: 2});
 signals.length = 0;
 const burst = Array.from({length: 19}, (_, i) => ({candidate: String(i)}));
 const emit = candidate => connections[0].onicecandidate({candidate: {toJSON: () => candidate}});
 burst.forEach(emit);
 assert.equal(signals.length, 0);
 t.mock.timers.tick(30);
 await new Promise(resolve => setImmediate(resolve));
 assert.deepEqual(
  signals.map(s => s.candidates.length),
  [16, 3]
 );
 assert.deepEqual(
  signals.flatMap(s => s.candidates),
  burst
 );
 emit(fresh);
 link.close();
 t.mock.timers.tick(100);
 assert.equal(signals.length, 2);
});

test('in-place restart buffers ICE for the new answer and ignores the previous generation', async t => {
 t.mock.timers.enable({apis: ['setTimeout']});
 const {link, connections, signals} = fixture(t, 'a');
 await link.offer();
 const initial = signals[0].connectionId;
 const answer = connectionId => ({iceVersion: 2, connectionId, description: {type: 'answer'}});
 await link.receive(answer(initial));
 await link.receive({restart: initial});
 await link.offer();
 const next = signals.find(s => s.restartOf === initial).connectionId;
 assert.notEqual(next, initial);
 assert.equal(connections.length, 1);
 const [pc] = connections;
 assert.equal(pc.restarted, true);
 await link.receive({connectionId: initial, candidates: [old]});
 await link.receive({connectionId: next, candidates: [fresh]});
 await link.receive(answer(initial));
 assert.deepEqual(pc.received, []);
 assert.equal(pc.signalingState, 'have-local-offer');
 await link.receive(answer(next));
 assert.deepEqual(pc.received, [fresh]);
 await link.receive({restart: next, replace: true});
 await link.offer();
 assert.equal(pc.signalingState, 'closed');
 assert.equal(connections.length, 2);
});

test('a lost restart answer falls back to a new connection and legacy peers use replacement directly', async t => {
 t.mock.timers.enable({apis: ['setTimeout']});
 const {link, connections, signals} = fixture(t, 'a');
 await link.offer();
 const id = signals[0].connectionId;
 await link.receive({connectionId: id, iceVersion: 2, description: {type: 'answer'}});
 await link.receive({restart: id});
 await link.offer();
 t.mock.timers.tick(20000);
 await link.offer();
 const replacement = signals.findLast(s => s.description).connectionId;
 assert.equal(connections.length, 2);
 await link.receive({connectionId: replacement, description: {type: 'answer'}});
 await link.receive({restart: replacement});
 await link.offer();
 assert.equal(connections.length, 3);
 assert.equal(connections[1].restarted, undefined);
});

test('lost acknowledgement retries the same ICE batch; receiver applies candidates once per generation', async t => {
 t.mock.timers.enable({apis: ['setTimeout']});
 const duplicate = {candidate: 'relay', sdpMid: '0'};
 let attempts = 0;
 const {link, connections, signals, errors} = fixture(t, 'z', payload => {
  if (payload.candidates?.some(c => c.candidate === 'relay') && ++attempts === 1) throw new Error('lost ack');
 });
 await link.receive({...offer('one'), iceVersion: 2});
 connections[0].onicecandidate({candidate: {toJSON: () => duplicate}});
 t.mock.timers.tick(30);
 await new Promise(resolve => setImmediate(resolve));
 t.mock.timers.tick(1000);
 await new Promise(resolve => setImmediate(resolve));
 assert.equal(attempts, 2);
 for (const payload of signals.filter(s => s.candidates?.some(c => c.candidate === 'relay')))
  await link.receive(payload);
 assert.deepEqual(connections[0].received, [duplicate]);
 assert.deepEqual(errors, []);
 await link.receive({...offer('two'), iceVersion: 2});
 await link.receive({connectionId: 'two', candidates: [duplicate]});
 assert.deepEqual(connections[1].received, [duplicate]);
});

test('retiring a peer cancels an ICE retry; permanent failures are surfaced immediately', async t => {
 t.mock.timers.enable({apis: ['setTimeout']});
 const {link, connections, signals, errors} = fixture(t, 'z', payload => {
  const item = payload.candidates?.[0]?.candidate;
  if (item === 'gone' || item === 'offline') throw new Error(item === 'gone' ? 'peer left' : 'lost ack');
 });
 await link.receive({...offer('one'), iceVersion: 2});
 for (const value of ['gone', 'offline']) {
  connections[0].onicecandidate({candidate: {toJSON: () => ({candidate: value})}});
  t.mock.timers.tick(30);
  await new Promise(resolve => setImmediate(resolve));
 }
 assert.deepEqual(
  errors.map(error => error.message),
  ['peer left']
 );
 const before = signals.length;
 link.close();
 t.mock.timers.tick(10000);
 await new Promise(resolve => setImmediate(resolve));
 assert.equal(signals.length, before);
});
