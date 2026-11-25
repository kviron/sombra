/* global AudioContext, document */
// Browser-only fixture. The runner substitutes only the backend; WebRTC is real.
import {createElement as h, useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {useVoice} from '../../src/features/voice-room/model/use-voice';
import {createVoiceSession} from '../../src/features/voice-room/model/voice-session';
import {defaultMedia} from '../../src/features/voice-room/model/voice-input';
import {useMediaPlayback} from '../../src/features/voice-room/model/use-media-playback';
import {useAudioDevices} from '../../src/features/voice-room/model/use-audio-devices';
import {selectMicrophones, selectSpeakers, watchMediaDevices} from '@/shared/lib/media-devices';

const nativePc = globalThis.RTCPeerConnection;
const connections = [];
globalThis.RTCPeerConnection = class extends nativePc {
 constructor(config) {
  super(config);
  connections.push(this);
 }
};
const peers = new Map(),
 signals = [];
const renewedTurn = {urls: 'turn:127.0.0.1:9', username: 'test', credential: 'renewed'};
const renewals = new Set();
const turnUrl = globalThis.voiceTestTurnUrl;
if (turnUrl) localStorage.setItem('mines-media', JSON.stringify({relay: true}));
function poll({client, after = 0}) {
 return {
  iceServers: [],
  peers: [...peers.values()],
  signals: signals.filter(s => s.target === client && s.id > after),
  cursor: signals.length
 };
}
globalThis.voiceTestBackend = {
 async join(p) {
  peers.set(p.client, {...p, user: p.client});
  if (turnUrl) return {...poll(p), iceServers: [{urls: turnUrl, username: 'sombra-test', credential: 'sombra-test'}]};
  return {...poll(p), iceTtlSeconds: 1};
 },
 poll: async p => {
  const data = poll(p);
  if (!p.refreshIce) return data;
  if (renewals.has(p.client)) throw new Error('TURN was refreshed again before expiry');
  renewals.add(p.client);
  return {...data, iceServers: [renewedTurn], iceTtlSeconds: 43200};
 },
 async signal({client: from, target, payload}) {
  signals.push({id: signals.length + 1, from, target, payload});
 },
 async leave({client}) {
  peers.delete(client);
 }
};
if (globalThis.voiceLiveKitTest) {
 // The SFU already routes audio through the server, even when the P2P preference is enabled.
 localStorage.setItem('mines-media', JSON.stringify({relay: true}));
 const send = op => async params => {
  const response = await fetch('/voice', {method: 'POST', body: JSON.stringify({...params, op})});
  const result = await response.json();
  if (!response.ok || !result.data) throw new Error(result.error || 'Voice request failed');
  return result.data;
 };
 globalThis.voiceTestBackend = {
  join: send('voice_join'),
  poll: send('voice_poll'),
  leave: send('voice_leave'),
  signal: () => {
   throw new Error('LiveKit used P2P signaling');
  }
 };
}
const audio = new AudioContext(),
 calls = [],
 oscillators = [];
navigator.mediaDevices.getUserMedia = async () => {
 await audio.resume();
 const tone = audio.createOscillator(),
  out = audio.createMediaStreamDestination();
 tone.frequency.value = oscillators.length ? 880 : 440;
 tone.connect(out);
 tone.start();
 oscillators.push(tone);
 return out.stream;
};
function Output({stream, speaker, muted}) {
 const {attach} = useMediaPlayback({stream, volume: 100, speaker, audioOnly: true});
 return h('audio', {ref: attach, autoPlay: true, muted});
}
function Client({id}) {
 const voice = useVoice();
 calls[id] = voice;
 useEffect(() => {
  void voice.join('loopback');
 }, []);
 const stream = Object.values(voice.streams)[0];
 return h(
  'section',
  {id: 'client' + id},
  stream?.getAudioTracks().length ? h(Output, {stream, speaker: voice.speakerOutput, muted: voice.deaf}) : null
 );
}
const root = createRoot(document.body.appendChild(document.createElement('div')));
root.render(h('div', {}, h(Client, {id: 0}), h(Client, {id: 1})));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, message, tries = 100) {
 for (let i = 0; i < tries; i++) {
  if (predicate()) return;
  await delay(20);
 }
 throw new Error(message);
}
async function checkDeviceMenus() {
 const media = navigator.mediaDevices;
 const original = media.enumerateDevices;
 const prototype = globalThis.HTMLMediaElement.prototype;
 const originalSetSinkId = prototype.setSinkId;
 const outputs = [];
 prototype.setSinkId = async function (id) {
  if (this.closest('#client0')) outputs.push(id);
 };
 let reads = 0;
 let devices = [
  {kind: 'audioinput', deviceId: 'mic', label: 'USB'},
  {kind: 'audiooutput', deviceId: 'speaker', label: 'Headphones'}
 ];
 media.enumerateDevices = async () => {
  reads++;
  return devices;
 };
 const stop = watchMediaDevices();
 const host = document.createElement('div');
 const menus = createRoot(host);
 function Menu({select}) {
  const {devices} = useAudioDevices(true, select);
  return h('span', {}, devices.map(device => device.label).join(' '));
 }
 try {
  const open = () =>
   menus.render(h('div', {}, h(Menu, {select: selectMicrophones}), h(Menu, {select: selectSpeakers})));
  open();
  await until(() => host.textContent === 'USBHeadphones', 'Menus did not share the initial device list');
  const initialReads = reads;
  menus.render(null);
  await until(() => !host.textContent, 'Device menus did not close');
  open();
  await until(() => host.textContent === 'USBHeadphones', 'Reopened menus lost the device list');
  if (reads !== initialReads) throw new Error('Reopening a device menu queried hardware');
  const savedDevices = devices;
  calls[0].savePreferences('speaker', 'speaker');
  await until(() => outputs.at(-1) === 'speaker', 'Call did not apply the selected speaker');
  devices = devices.slice(0, 1);
  media.dispatchEvent(new Event('devicechange'));
  await until(() => outputs.at(-1) === '', 'Call did not fall back to the system audio output');
  if (calls[0].preferences.speaker !== 'speaker') throw new Error('Device removal overwrote the saved speaker');
  devices = savedDevices;
  media.dispatchEvent(new Event('devicechange'));
  await until(() => outputs.at(-1) === 'speaker', 'Call did not restore the saved speaker');
  devices = devices.slice(1);
  media.dispatchEvent(new Event('devicechange'));
  await until(() => host.textContent === 'Headphones', 'Device removal did not reach the open menus');
 } finally {
  calls[0].savePreferences('speaker', '');
  prototype.setSinkId = originalSetSinkId;
  menus.unmount();
  stop();
  media.enumerateDevices = original;
 }
}
async function checkMediaControls() {
 const original = calls[0].local.getAudioTracks()[0];
 const replaceTrack = globalThis.RTCRtpSender.prototype.replaceTrack;
 let rejected = false;
 globalThis.RTCRtpSender.prototype.replaceTrack = function (track) {
  if (!rejected && track?.kind === 'audio') {
   rejected = true;
   return Promise.reject(new Error('Test replacement failure'));
  }
  return replaceTrack.call(this, track);
 };
 try {
  calls[0].savePreferences('mic', 'failed-device');
  await until(() => !calls[0].store.getState().busy, 'Track replacement did not settle');
  const state = calls[0].store.getState();
  if (
   !rejected ||
   !state.error ||
   state.preferences.mic ||
   state.local.getAudioTracks()[0] !== original ||
   original.readyState !== 'live'
  )
   throw new Error('Failed device replacement did not restore the original microphone');
 } finally {
  globalThis.RTCRtpSender.prototype.replaceTrack = replaceTrack;
 }
 calls[0].toggleMic();
 if (original.enabled || calls[1].store.getState().availability.muted)
  throw new Error('Mute did not stay within its session');
 calls[0].setMicVolume(50);
 await until(() => !calls[0].store.getState().busy, 'Microphone gain did not settle');
 const gained = calls[0].store.getState().local.getAudioTracks()[0];
 if (gained === original || gained.enabled || calls[0].store.getState().micVolume !== 50)
  throw new Error('Microphone gain lost the muted state');
 calls[0].savePreferences('mic', 'replacement');
 await until(() => !calls[0].store.getState().busy, 'Device change did not settle');
 if (original.readyState !== 'ended' || calls[0].store.getState().preferences.mic !== 'replacement')
  throw new Error('Device change did not replace the microphone');
 calls[0].toggleMic();
 calls[0].toggleDeaf();
 calls[0].toggleDeaf();
 if (!gained.enabled || calls[0].store.getState().availability.deaf)
  throw new Error('Unmute/deafen controls lost the active microphone');
}
async function checkRecovery() {
 const backend = globalThis.voiceTestBackend;
 const third = createVoiceSession(defaultMedia);
 try {
  await third.actions.join('loopback');
  await until(
   () => connections.filter(pc => pc.connectionState === 'connected').length === 6,
   'Third client did not connect',
   400
  );
  const stable = connections.filter(pc => pc.connectionState === 'connected');
  const broken = stable.find(pc => pc.remoteDescription?.type === 'offer');
  const originalOffer = broken.remoteDescription.sdp;
  const ufrag = sdp => /^a=ice-ufrag:(.+)$/m.exec(sdp)?.[1];
  const pair = stable.filter(pc => pc === broken || ufrag(pc.localDescription.sdp) === ufrag(originalOffer));
  if (pair.length !== 2) throw new Error('Could not identify the P2P pair');
  await until(() => renewals.size === 3, 'TURN was not refreshed during the call');
  Object.defineProperty(broken, 'connectionState', {get: () => 'failed', configurable: true});
  broken.dispatchEvent(new Event('connectionstatechange'));
  await until(
   () =>
    pair.every(pc => pc.signalingState === 'stable') && ufrag(broken.remoteDescription.sdp) !== ufrag(originalOffer),
   'Answerer did not negotiate fresh ICE credentials',
   500
  );
  delete broken.connectionState;
  await until(() => stable.every(pc => pc.connectionState === 'connected'), 'ICE restart lost a connection');
  if (pair.some(pc => !pc.getConfiguration().iceServers.some(server => server.credential === renewedTurn.credential)))
   throw new Error('ICE restart used the old TURN configuration');
  if (connections.some(pc => !stable.includes(pc) && pc.signalingState !== 'closed'))
   throw new Error('ICE restart replaced a connection');
  const probes = pair.map(pc => {
   const receiver = pc.getReceivers().find(r => r.track.kind === 'audio');
   const source = audio.createMediaStreamSource(new globalThis.MediaStream([receiver.track]));
   const analyser = audio.createAnalyser();
   source.connect(analyser);
   return {source, analyser};
  });
  try {
   await until(
    () =>
     probes.every(({analyser}) => {
      const bins = new Float32Array(analyser.frequencyBinCount);
      analyser.getFloatFrequencyData(bins);
      const peak = Math.max(...bins);
      const hz = (bins.indexOf(peak) * audio.sampleRate) / analyser.fftSize;
      return peak > -70 && [440, 880].some(tone => Math.abs(hz - tone) < 35);
     }),
    'Restored link did not receive the test tone in both directions',
    200
   );
  } finally {
   probes.forEach(({source}) => source.disconnect());
  }
  let restartRejected = false;
  globalThis.voiceTestBackend = {
   ...backend,
   async signal(p) {
    if (p.payload.restartOf && !restartRejected) {
     restartRejected = true;
     throw new Error('Test restart offer delivery failure');
    }
    return backend.signal(p);
   }
  };
  const offerer = pair.find(pc => pc.localDescription.type === 'offer');
  Object.defineProperty(offerer, 'connectionState', {get: () => 'failed', configurable: true});
  offerer.dispatchEvent(new Event('connectionstatechange'));
  await until(
   () =>
    restartRejected &&
    pair.every(pc => pc.signalingState === 'closed') &&
    connections.filter(pc => pc.connectionState === 'connected').length === 6,
   'Failed ICE restart did not replace the pair',
   500
  );
  if (stable.filter(pc => pc.signalingState !== 'closed').length !== 4)
   throw new Error('Fallback disturbed another peer');
  let rejected = false;
  const target = 'zz-departed';
  globalThis.voiceTestBackend = {
   ...backend,
   async poll(p) {
    const result = await backend.poll(p);
    if (!rejected) result.peers.push({client: target, user: target});
    return result;
   },
   async signal(p) {
    if (p.target === target) {
     if (p.payload.description) rejected = true;
     throw new Error('Peer left');
    }
    return backend.signal(p);
   }
  };
  await until(() => rejected, 'No signal sent to departed peer');
  await delay(1100);
  if (peers.size !== 3 || connections.filter(pc => pc.connectionState === 'connected').length !== 6)
   throw new Error('Departure disrupted other participants');
 } finally {
  globalThis.voiceTestBackend = backend;
  third.actions.leave();
 }
}
async function checkLostMicrophone() {
 const call = calls[0];
 const mic = call.store.getState().local.getAudioTracks()[0];
 mic.stop();
 mic.dispatchEvent(new Event('ended'));
 await until(() => calls[0].microphoneLost && calls[0].muted, 'Lost input still shown as active');
 call.toggleMic();
 await until(() => !calls[0].microphoneLost && !calls[0].busy, 'Could not reacquire the same microphone');
 if (!calls[0].room || calls[0].muted || calls[0].local.getAudioTracks()[0].readyState !== 'live')
  throw new Error('Microphone recovery lost the call or mute state');
}
async function checkLateCapture() {
 const capture = navigator.mediaDevices.getUserMedia;
 const stream = audio.createMediaStreamDestination().stream;
 let release;
 navigator.mediaDevices.getUserMedia = () =>
  new Promise(resolve => {
   release = resolve;
  });
 const session = createVoiceSession(defaultMedia);
 try {
  const joined = session.actions.join('late-capture');
  session.actions.leave();
  release(stream);
  if ((await joined) || stream.getTracks().some(track => track.readyState !== 'ended') || session.store.getState().room)
   throw new Error('Cancelled capture retained a device or joined the room');
 } finally {
  session.actions.leave();
  navigator.mediaDevices.getUserMedia = capture;
 }
}
async function checkCancelledNegotiation() {
 const originalPeerConnection = globalThis.RTCPeerConnection;
 const backend = globalThis.voiceTestBackend;
 const created = [];
 let entered, release;
 const signaling = new Promise(resolve => {
  entered = resolve;
 });
 const blocked = new Promise(resolve => {
  release = resolve;
 });
 globalThis.RTCPeerConnection = class extends originalPeerConnection {
  constructor(config) {
   super(config);
   created.push(this);
  }
 };
 globalThis.voiceTestBackend = {
  join: () => ({peers: [], signals: [], cursor: 0, iceServers: []}),
  poll: () => ({
   peers: [
    {client: 'zz-b', user: 'b'},
    {client: 'zz-c', user: 'c'}
   ],
   signals: [],
   cursor: 0
  }),
  signal: async () => {
   entered();
   await blocked;
  },
  leave: async () => {}
 };
 const session = createVoiceSession(defaultMedia);
 try {
  await session.actions.join('cancel-negotiation');
  await Promise.race([
   signaling,
   delay(3000).then(() => {
    throw new Error('No offer sent');
   })
  ]);
  session.actions.leave();
  release();
  await delay(100);
  if (created.some(pc => pc.connectionState !== 'closed'))
   throw new Error('Cancelled signaling created an orphan peer connection');
 } finally {
  session.actions.leave();
  created.forEach(pc => pc.close());
  globalThis.RTCPeerConnection = originalPeerConnection;
  globalThis.voiceTestBackend = backend;
 }
}
async function check() {
 for (let i = 0; i < 100; i++) {
  const elements = [...document.querySelectorAll('audio')];
  if (
   elements.length === 2 &&
   elements.every(e => !e.paused && e.currentTime > 0 && e.srcObject?.getAudioTracks().length)
  ) {
   const probes = elements.map(e => {
    const source = audio.createMediaStreamSource(e.srcObject),
     analyser = audio.createAnalyser();
    source.connect(analyser);
    return {source, analyser};
   });
   await delay(250);
   const peaks = probes.map(({source, analyser}) => {
    const bins = new Float32Array(analyser.frequencyBinCount);
    analyser.getFloatFrequencyData(bins);
    source.disconnect();
    return Math.round((bins.indexOf(Math.max(...bins)) * audio.sampleRate) / analyser.fftSize);
   });
   if (peaks.every(p => p > 0) && peaks.some(p => Math.abs(p - 440) < 35) && peaks.some(p => Math.abs(p - 880) < 35)) {
    if (turnUrl) {
     const reports = await Promise.all(connections.map(pc => pc.getStats()));
     if (
      reports.length !== 2 ||
      reports.some(
       stats =>
        ![...stats.values()].some(entry => {
         if (entry.type !== 'transport') return false;
         const pair = stats.get(entry.selectedCandidatePairId);
         return stats.get(pair?.localCandidateId)?.candidateType === 'relay';
        })
      )
     )
      throw new Error('Both clients must select a TURN relay candidate');
     root.unmount();
     return {ok: true, turnRelay: true, receiverHz: peaks};
    }
    if (globalThis.voiceLiveKitTest) {
     if (!calls.every(call => call.audioOnly)) throw new Error('Clients did not join the audio-only pilot');
     calls[0].toggleMic();
     calls[0].toggleDeaf();
     await until(
      () => elements[0].muted && !calls[0].local.getAudioTracks()[0].enabled,
      'LiveKit deafen did not mute both paths'
     );
     calls[0].toggleDeaf();
     await until(() => !elements[0].muted && calls[0].muted, 'Undeafen lost the saved mute');
     calls[0].toggleMic();
     await until(() => calls[0].local.getAudioTracks()[0].enabled, 'LiveKit microphone did not unmute');
     const tracks = calls.flatMap(call => call.local.getTracks());
     root.unmount();
     if (tracks.some(track => track.readyState !== 'ended')) throw new Error('LiveKit retained the capture on unmount');
     return {ok: true, liveKit: true, receiverHz: peaks, mediaControls: true, unmountReleased: true};
    }
    await checkDeviceMenus();
    await checkRecovery();
    await checkLostMicrophone();
    await checkMediaControls();
    const tracks = calls.flatMap(v => v.store.getState().local.getTracks());
    root.unmount();
    await delay(50);
    if (peers.size || tracks.some(track => track.readyState !== 'ended'))
     return {ok: false, error: 'Unmount left microphone tracks or room membership active', members: peers.size};
    await checkCancelledNegotiation();
    await checkLateCapture();
    return {
     ok: true,
     receiverHz: peaks,
     deviceMenus: true,
     peerRecovery: true,
     lostMicrophoneRecovered: true,
     unmountReleased: true,
     cancelledNegotiation: true,
     mediaControls: true,
     lateCaptureReleased: true
    };
   }
  }
  await delay(150);
 }
 return {
  ok: false,
  states: calls.map(v => ({
   connections: Object.values(v.connections),
   error: v.error,
   streams: Object.keys(v.streams).length
  }))
 };
}
check()
 .catch(e => ({ok: false, error: String(e)}))
 .then(result => fetch('/result', {method: 'POST', body: JSON.stringify(result)}));
