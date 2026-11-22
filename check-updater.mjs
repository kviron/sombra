import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createUpdater} from './src/features/updates/model/update-controller.ts';

function fixture(check) {
 let installed = 0,
  restarted = 0;
 const update = {
  version: '0.2.0',
  body: 'Changes',
  download: async cb => {
   cb({event: 'Started', data: {contentLength: 100}});
   cb({event: 'Progress', data: {chunkLength: 100}});
  },
  install: async () => {
   installed++;
  },
  close: async () => {}
 };
 const controller = createUpdater({
  check: check || (async () => update),
  relaunch: async () => {
   restarted++;
  }
 });
 return {controller, update, installed: () => installed, restarted: () => restarted};
}
test('checking and downloading never install without an explicit action', async () => {
 const f = fixture();
 await f.controller.check();
 assert.equal(f.controller.snapshot().phase, 'available');
 await f.controller.download();
 assert.equal(f.controller.snapshot().phase, 'ready');
 assert.equal(f.installed(), 0);
 await f.controller.install();
 assert.equal(f.installed(), 1);
 assert.equal(f.restarted(), 1);
});
test('an offline check is retryable and is not reported as up to date', async () => {
 let offline = true;
 const f = fixture(async () => {
  if (offline) throw Error('offline');
  return null;
 });
 await f.controller.check();
 assert.equal(f.controller.snapshot().phase, 'error');
 offline = false;
 await f.controller.check();
 assert.equal(f.controller.snapshot().phase, 'current');
});
test('overlapping checks and checks after download cannot discard the pending update', async () => {
 let resolve,
  calls = 0;
 const f = fixture(() => {
  calls++;
  return new Promise(r => {
   resolve = r;
  });
 });
 const first = f.controller.check();
 await f.controller.check();
 assert.equal(calls, 1);
 resolve(f.update);
 await first;
 await f.controller.download();
 await f.controller.check();
 assert.equal(calls, 1);
 assert.equal(f.controller.snapshot().phase, 'ready');
});
test('a failed signature/download never enables installation and can be retried', async () => {
 const f = fixture();
 await f.controller.check();
 f.update.download = async () => {
  throw Error('signature');
 };
 await f.controller.download();
 assert.equal(f.controller.snapshot().phase, 'error');
 await f.controller.install();
 assert.equal(f.installed(), 0);
 f.update.download = async () => {};
 await f.controller.check();
 await f.controller.download();
 assert.equal(f.controller.snapshot().phase, 'ready');
});
