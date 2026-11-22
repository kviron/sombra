/* global document -- тест подставляет минимальную заглушку DOM */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fxSchedulerState, MAX_ANIMATED_FX, registerFxJob} from '../scheduler.ts';

function environment(t, withObserver = true) {
 const callbacks = new Map();
 const instances = [];
 let id = 0;
 let now = 0;
 globalThis.window = {
  requestAnimationFrame(callback) {
   callbacks.set(id, callback);
   return id++;
  },
  cancelAnimationFrame(request) {
   callbacks.delete(request);
  }
 };
 globalThis.document = Object.assign(new EventTarget(), {hidden: false});
 if (withObserver)
  globalThis.IntersectionObserver = class {
   targets = new Set();
   disconnected = false;
   constructor(callback) {
    this.callback = callback;
    instances.push(this);
   }
   observe(target) {
    this.targets.add(target);
   }
   unobserve(target) {
    this.targets.delete(target);
   }
   disconnect() {
    this.disconnected = true;
    this.targets.clear();
   }
  };
 const handles = [];
 t.after(() => {
  handles.forEach(handle => handle.dispose());
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.IntersectionObserver;
 });
 return {
  instances,
  callbacks,
  add(priority = null) {
   const canvas = {closest: () => (priority ? {getAttribute: () => priority} : null)};
   const job = {canvas, paints: 0, advances: []};
   job.handle = registerFxJob({canvas, paint: () => job.paints++, advance: dt => job.advances.push(dt)});
   handles.push(job.handle);
   return job;
  },
  visible(jobs, isIntersecting = true) {
   instances[0].callback(jobs.map(({canvas: target}) => ({target, isIntersecting})));
  },
  frame(ms = 34) {
   const pending = [...callbacks.values()];
   callbacks.clear();
   now += ms;
   pending.forEach(callback => callback(now));
  },
  hide(hidden) {
   document.hidden = hidden;
   document.dispatchEvent(new Event('visibilitychange'));
  }
 };
}

test('one observer batches visibility and spreads static first paints across frames', t => {
 const env = environment(t);
 const jobs = Array.from({length: 20}, () => env.add());
 const offscreen = env.add();
 assert.equal(env.instances.length, 1);
 assert.equal(env.instances[0].targets.size, 21);
 assert.equal(env.callbacks.size, 0);
 env.visible(jobs);
 assert.equal(env.callbacks.size, 1);
 assert.equal(fxSchedulerState().painted, 0);
 env.frame();
 assert.equal(fxSchedulerState().animated, MAX_ANIMATED_FX);
 assert.equal(fxSchedulerState().painted, 4);
 for (let i = 0; i < 9; i++) env.frame();
 assert.equal(fxSchedulerState().painted, 20);
 assert.equal(offscreen.paints, 0);
 assert.ok(
  jobs.every(job => job.paints >= 2 && job.advances.length > 0),
  'every visible avatar animates even above the frame budget'
 );
 env.visible(jobs, false);
 assert.equal(env.callbacks.size, 0);
 env.frame();
 assert.equal(fxSchedulerState().animated, 0);
 const previousPaints = jobs.at(-1).paints;
 env.visible(jobs.slice(-1));
 env.frame();
 assert.equal(jobs.at(-1).paints, previousPaints + 1);
});

test('priority previews take slots immediately without repainting displaced canvases', t => {
 const env = environment(t);
 const background = Array.from({length: 4}, () => env.add());
 env.visible(background);
 env.frame();
 const picker = [env.add('picker'), env.add('picker')];
 const profile = [env.add('profile'), env.add('profile')];
 env.visible(picker);
 env.visible(profile);
 env.frame();
 env.frame();
 assert.ok([...profile, ...picker].every(job => job.paints === 2 && job.advances.length === 1));
 assert.ok(background.every(job => job.paints === 1));
 profile.forEach(({handle}) => handle.dispose());
 picker.forEach(({handle}) => handle.dispose());
 env.frame();
 assert.ok(background.every(job => job.paints === 2));
});

test('hidden or disposed canvases are never painted by pending callbacks', t => {
 const env = environment(t);
 const job = env.add();
 env.visible([job]);
 env.frame();
 env.hide(true);
 assert.equal(env.callbacks.size, 0);
 env.frame(4000);
 const replacement = env.add();
 env.visible([replacement]);
 assert.equal(replacement.paints, 0);
 env.hide(false);
 env.frame();
 assert.equal(job.advances.length, 0, 'no catch-up advance after a pause');
 assert.equal(replacement.paints, 1);
 replacement.handle.dispose();
 job.handle.dispose();
 env.visible([job]);
 assert.equal(env.callbacks.size, 0);
 assert.equal(env.instances[0].disconnected, true);
 assert.equal(fxSchedulerState().jobs, 0);
});

test('browsers without IntersectionObserver still paint visible jobs', t => {
 const env = environment(t, false);
 const job = env.add();
 env.frame();
 assert.equal(job.paints, 1);
});
