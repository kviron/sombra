import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createMediaDevicesStore} from './store.ts';
import {selectCameras, selectDevicesLoading, selectMicrophones, selectSpeakers} from './selectors.ts';

const mic = {deviceId: 'mic', kind: 'audioinput', label: 'USB'};
const speaker = {deviceId: 'out', kind: 'audiooutput', label: 'Headphones'};

test('селекторы читают общий снимок, пока обновление в работе или завершилось ошибкой', async t => {
 let list = [mic, speaker];
 const enumerate = t.mock.fn(async () => list.map(device => ({...device})));
 const store = createMediaDevicesStore({
  enumerate,
  readContext: async () => null,
  requestMicrophoneAccess: async () => {}
 });
 const {refresh} = store.getState();
 assert.equal(selectDevicesLoading(store.getState()), false);
 const firstLoad = refresh();
 assert.equal(selectDevicesLoading(store.getState()), true);
 assert.equal(store.getState().loaded, false);
 await firstLoad;
 const cached = store.getState().devices;
 const inputs = selectMicrophones(store.getState());
 assert.deepEqual(inputs, [mic]);
 assert.deepEqual(selectSpeakers(store.getState()), [speaker]);
 assert.deepEqual(selectCameras(store.getState()), []);
 assert.equal(enumerate.mock.callCount(), 1);
 await refresh();
 assert.equal(selectMicrophones(store.getState()), inputs);
 assert.equal(store.getState().devices, cached);

 let finish;
 enumerate.mock.mockImplementationOnce(
  () =>
   new Promise(resolve => {
    finish = resolve;
   })
 );
 const pending = refresh();
 await Promise.resolve();
 assert.equal(selectDevicesLoading(store.getState()), true);
 assert.equal(store.getState().loaded, true);
 assert.equal(store.getState().devices, cached);
 list = [speaker];
 const changedWhileLoading = refresh();
 finish(cached);
 await Promise.all([pending, changedWhileLoading]);
 assert.equal(selectDevicesLoading(store.getState()), false);
 assert.deepEqual(selectMicrophones(store.getState()), []);
 const latest = store.getState().devices;
 enumerate.mock.mockImplementationOnce(async () => {
  throw new Error('unavailable');
 });
 await refresh();
 assert.ok(store.getState().error);
 assert.equal(store.getState().devices, latest);
 assert.equal(selectDevicesLoading(store.getState()), false);
});

test('один запрос разрешения обслуживает обе панели и обновляет список устройств', async t => {
 let devices = [speaker];
 const service = {
  enumerate: async () => devices,
  readContext: async () => null,
  requestMicrophoneAccess: t.mock.fn(async () => {
   devices = [mic, speaker];
  })
 };
 const store = createMediaDevicesStore(service);
 await store.getState().refresh();
 assert.equal(service.requestMicrophoneAccess.mock.callCount(), 0);
 await Promise.all([store.getState().requestAccess(), store.getState().requestAccess()]);
 assert.equal(service.requestMicrophoneAccess.mock.callCount(), 1);
 assert.equal(store.getState().requesting, false);
 assert.deepEqual(selectMicrophones(store.getState()), [mic]);
});
