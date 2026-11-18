// Real-browser check for the avatar/cover decoration engine: the actual UserAvatar/AvatarFrame React source in an
// isolated local Vite page. No backend, no production claims; synthetic local avatar/cover images only.
//
//   node check-avatar-fx-browser.mjs
//
// Writes screenshots and result.json into avatar-fx-qa/<timestamp>/.
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import net from 'node:net';
import { inflateSync } from 'node:zlib';

const out = `avatar-fx-qa/${Date.now()}`;
mkdirSync(out, { recursive: true });
const checks = [];
const errors = [];
const sockets = [];
const requests = [];
const consoleErrors = [];
let server;
let chrome;
let tab;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function until(fn, label, tries = 200) {
  let last;
  for (let index = 0; index < tries; index++) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      last = error;
    }
    await sleep(100);
  }
  throw Error(`Timeout ${label} ${last?.message ?? ''}`);
}

function port() {
  return new Promise((done, fail) => {
    const probe = net.createServer();
    probe.once('error', fail);
    probe.listen(0, '127.0.0.1', () => {
      const value = probe.address().port;
      probe.close(() => done(value));
    });
  });
}

async function connect(url) {
  const socket = new WebSocket(url);
  sockets.push(socket);
  await new Promise((done) => socket.addEventListener('open', done, { once: true }));
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.method === 'Network.requestWillBeSent') requests.push(message.params.request.url);
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      consoleErrors.push(message.params.args.map((arg) => arg.value ?? arg.description ?? arg.type).join(' '));
    }
    const handler = pending.get(message.id);
    if (handler) {
      pending.delete(message.id);
      if (message.error) handler[1](Error(message.error.message));
      else handler[0](message.result);
    }
  });
  const send = (method, params = {}) =>
    new Promise((done, fail) => {
      const messageId = ++id;
      pending.set(messageId, [done, fail]);
      socket.send(JSON.stringify({ id: messageId, method, params }));
    });
  const evaluate = async (expression) => {
    const outcome = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (outcome.exceptionDetails) throw Error(JSON.stringify(outcome.exceptionDetails.exception?.description ?? outcome.exceptionDetails));
    return outcome.result.value;
  };
  return { send, evaluate, wait: (expression) => until(() => evaluate(expression), expression) };
}

function ok(condition, label, detail = '') {
  assert.ok(condition, `${label}${detail ? ` (${detail})` : ''}`);
  checks.push(label);
  console.log(`PASS ${label}${detail ? ` — ${detail}` : ''}`);
}

async function shot(name, clip) {
  const result = await tab.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: Boolean(clip),
    ...(clip ? { clip: { ...clip, scale: 2 } } : {}),
  });
  const buffer = Buffer.from(result.data, 'base64');
  writeFileSync(`${out}/${name}.png`, buffer);
  return decodePng(buffer);
}

// Minimal PNG reader for Chrome screenshots: 8-bit RGB/RGBA, filter types 0–4, no interlace.
function decodePng(buffer) {
  assert.equal(buffer.readUInt32BE(0), 0x89504e47, 'png signature');
  let offset = 8;
  let header;
  const chunks = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      header = { w: data.readUInt32BE(0), h: data.readUInt32BE(4), depth: data[8], color: data[9], interlace: data[12] };
    } else if (type === 'IDAT') chunks.push(data);
    offset += 12 + length;
    if (type === 'IEND') break;
  }
  const channels = header.color === 6 ? 4 : header.color === 2 ? 3 : 0;
  assert.ok(channels && header.depth === 8 && header.interlace === 0, `unsupported png ${JSON.stringify(header)}`);
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = header.w * channels;
  const pixels = Buffer.alloc(stride * header.h);
  let cursor = 0;
  for (let y = 0; y < header.h; y++) {
    const filter = raw[cursor++];
    const line = raw.subarray(cursor, cursor + stride);
    cursor += stride;
    const previous = y ? pixels.subarray((y - 1) * stride, y * stride) : null;
    const current = pixels.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? current[x - channels] : 0;
      const up = previous ? previous[x] : 0;
      const upLeft = previous && x >= channels ? previous[x - channels] : 0;
      let value = line[x];
      if (filter === 1) value = (value + left) & 255;
      else if (filter === 2) value = (value + up) & 255;
      else if (filter === 3) value = (value + ((left + up) >> 1)) & 255;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        value = (value + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft)) & 255;
      }
      current[x] = value;
    }
  }
  return { width: header.w, height: header.h, channels, pixels };
}

function pixel(image, x, y) {
  const index = (y * image.width + x) * image.channels;
  return [image.pixels[index], image.pixels[index + 1], image.pixels[index + 2], image.channels === 4 ? image.pixels[index + 3] : 255];
}

/** Count pixels matching a predicate in a disc or an annulus of the clip, relative to `centre`/`radius`. */
function countInRing(image, centre, radius, from, to, predicate) {
  let count = 0;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const distance = Math.hypot(x - centre.x, y - centre.y) / radius;
      if (distance < from || distance > to) continue;
      if (predicate(pixel(image, x, y))) count += 1;
    }
  }
  return count;
}

function rectExpression(selector, index = 0) {
  return `(()=>{const el=document.querySelectorAll(${JSON.stringify(selector)})[${index}];if(!el)return null;const r=el.getBoundingClientRect();return {x:r.left+scrollX,y:r.top+scrollY,width:r.width,height:r.height}})()`;
}

const isEmber = ([r, g, b]) => r > 190 && g > 55 && g < 215 && b < 130;
const isGoo = ([r, g, b]) => g > 110 && g > r * 1.25 && g > b * 1.12;
const isAurora = ([r, g, b]) => g > 85 && g > r * 1.12 && g > b * 1.02;

try {
  const webPort = await port();
  const cdpPort = await port();
  const previewRoot = resolve('ui/shared/ui/avatar-fx/preview');
  server = await createServer({
    configFile: false,
    root: process.cwd(),
    cacheDir: resolve(out, 'vite-cache'),
    optimizeDeps: { entries: [resolve(previewRoot, 'index.html')] },
    plugins: [react()],
    resolve: { alias: { '@': resolve('ui') } },
    server: {
      host: '127.0.0.1',
      port: webPort,
      strictPort: true,
      watch: { ignored: ['**/target/**', '**/dist/**', '**/data/**', '**/*-qa/**', '**/vendor/pixelfx/**'] },
    },
  });
  await server.listen();
  const origin = `http://127.0.0.1:${webPort}`;

  chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--hide-scrollbars',
    '--mute-audio',
    '--no-first-run',
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${resolve(out, 'browser')}`,
    'about:blank',
  ], { stdio: 'ignore', windowsHide: true });

  const pages = await until(async () => {
    const list = await (await fetch(`http://127.0.0.1:${cdpPort}/json`)).json();
    return list.length && list;
  }, 'CDP');
  tab = await connect(pages.find((page) => page.type === 'page').webSocketDebuggerUrl);
  await tab.send('Page.enable');
  await tab.send('Runtime.enable');
  await tab.send('Network.enable');
  await tab.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 2, mobile: false });
  await tab.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__qaErrors=[];addEventListener('error',e=>__qaErrors.push(String(e.message||e.error)));addEventListener('unhandledrejection',e=>__qaErrors.push(String(e.reason)));
      window.__qaCanvasContexts=new WeakSet();const getContext=HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext=function(...args){__qaCanvasContexts.add(this);return getContext.apply(this,args)};`,
  });
  await tab.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await tab.send('Page.navigate', { url: `${origin}/ui/shared/ui/avatar-fx/preview/index.html` });
  await tab.wait('!!window.__sombraAvatarFx');

  const canvases = await tab.evaluate('window.__sombraAvatarFx.canvases()');
  ok(canvases.length >= 14, 'decorations create canvases inside the real UserAvatar', `${canvases.length} canvases`);

  const ringCanvas = canvases.find((canvas) => canvas.effect === 'holy/divine-shield' && canvas.width === 176);
  ok(Boolean(ringCanvas), 'the xl avatar uses a 176 px effect grid');
  ok(ringCanvas.cssWidth === 176, 'xl ring canvas is twice the 88 px avatar wide', `${ringCanvas.cssWidth}px`);

  const mask = await tab.evaluate(`getComputedStyle(document.querySelector('.avatar-fx__canvas--ring')).maskImage || getComputedStyle(document.querySelector('.avatar-fx__canvas--ring')).webkitMaskImage`);
  ok(/radial-gradient/.test(mask), 'ring canvases are masked with a radial gradient (face is never painted)', mask);

  const pixelated = await tab.evaluate(`getComputedStyle(document.querySelector('.avatar-fx__canvas--ring')).imageRendering`);
  ok(pixelated === 'pixelated', 'ring canvas is nearest-neighbour scaled', pixelated);

  const cornerMask = await tab.evaluate(`getComputedStyle(document.querySelector('.avatar-fx__canvas--corner')).maskImage`);
  ok(/linear-gradient|radial-gradient/.test(cornerMask), 'corner canvases fade their edges so the glow cannot show as a rectangle', cornerMask.slice(0, 60));
  const cornerSize = await tab.evaluate(`(()=>{const c=document.querySelector('#qa-slime .user-avatar');const canvas=c.querySelector('.avatar-fx__canvas');const size=c.getBoundingClientRect().width;return {canvas:canvas.getBoundingClientRect().width,size}})()`);
  ok(Math.abs(cornerSize.canvas - cornerSize.size * 0.8) < 2, 'corner canvas is 80% of the avatar', `${cornerSize.canvas}/${cornerSize.size}`);

  const coverCanvas = canvases.find((canvas) => canvas.effect === 'weather/aurora');
  ok(Boolean(coverCanvas), 'the cover decoration creates a canvas');
  ok(coverCanvas.width === 320 && coverCanvas.height === 107, 'cover effect renders its own 320x107 pixel grid', `${coverCanvas.width}x${coverCanvas.height}`);
  const coverCss = await tab.evaluate(`(()=>{const c=document.querySelector('.avatar-fx--cover .avatar-fx__canvas');const s=getComputedStyle(c);return {blend:s.mixBlendMode,width:c.getBoundingClientRect().width,cover:document.querySelector('.profile-cover').getBoundingClientRect().width}})()`);
  ok(coverCss.blend === 'screen', 'cover effect is screen-blended over the cover', coverCss.blend);
  ok(Math.abs(coverCss.width - coverCss.cover) < 4, 'cover canvas fills the cover box', `${coverCss.width}/${coverCss.cover}`);

  const first = await tab.wait('window.__sombraAvatarFx.state().frames > 1 && window.__sombraAvatarFx.state()');
  ok(first.painted > 0, 'visible layers painted', `painted ${first.painted}`);
  ok(first.animated <= 4, 'no more than four canvases animate at once', `animated ${first.animated} of ${first.visible} visible`);
  const painted = await tab.wait('(()=>{const s=window.__sombraAvatarFx.state();return s.painted === s.visible && s})()');
  ok(painted.visible > 4, 'the static queue eventually paints every visible layer', `${painted.painted}/${painted.visible}`);
  const deferredCanvas = await tab.evaluate(`Array.from(document.querySelectorAll('.avatar-fx__canvas')).findIndex(canvas =>
    canvas.getBoundingClientRect().top > innerHeight + 96 && !__qaCanvasContexts.has(canvas))`);
  ok(deferredCanvas >= 0, 'off-screen canvases do not initialize a drawing context at mount');

  const framesBefore = first.frames;
  await sleep(400);
  const later = await tab.evaluate('window.__sombraAvatarFx.state()');
  ok(later.frames > framesBefore, 'the shared loop advances from a single rAF loop', `${framesBefore} -> ${later.frames}`);
  ok(later.lastPaintMs < 40, 'painting the animated set stays under the frame budget', `${later.lastPaintMs.toFixed(2)} ms`);

  const hit = await tab.evaluate(`(()=>{const el=document.querySelectorAll('#qa-ring .demo')[3].querySelector('.user-avatar');const r=el.getBoundingClientRect();const top=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return top?top.tagName+':'+top.className:''})()`);
  ok(!hit.startsWith('CANVAS'), 'decoration never intercepts pointer hits on the avatar centre', hit);

  // ---- screenshots + pixel checks
  await tab.evaluate('scrollTo(0,0)');
  await sleep(200);
  const ringRect = await tab.evaluate(rectExpression('#qa-ring .demo .user-avatar', 3));
  const ringImage = await shot('ring-xl', { x: ringRect.x - 8, y: ringRect.y - 8, width: ringRect.width + 16, height: ringRect.height + 16 });
  const ringCentre = {
    x: ((ringRect.width / 2 + 8) * ringImage.width) / (ringRect.width + 16),
    y: ((ringRect.height / 2 + 8) * ringImage.height) / (ringRect.height + 16),
  };
  const ringRadius = (ringRect.width / 2) * (ringImage.width / (ringRect.width + 16));
  const hotCentre = countInRing(ringImage, ringCentre, ringRadius, 0, 0.55, isEmber);
  const hotBand = countInRing(ringImage, ringCentre, ringRadius, 0.92, 1.38, isEmber);
  ok(hotCentre < 4, 'no ember pixels over the avatar face (ring stays outside)', `${hotCentre} hot pixels`);
  ok(hotBand > 30, 'the ember ring is visible just outside the avatar edge', `${hotBand} hot pixels`);

  const initialsRect = await tab.evaluate(rectExpression('#qa-ring .demo .user-avatar', 4));
  const initialsImage = await shot('ring-initial', { x: initialsRect.x - 8, y: initialsRect.y - 8, width: initialsRect.width + 16, height: initialsRect.height + 16 });
  const initialsCentre = {
    x: ((initialsRect.width / 2 + 8) * initialsImage.width) / (initialsRect.width + 16),
    y: ((initialsRect.height / 2 + 8) * initialsImage.height) / (initialsRect.height + 16),
  };
  const initialsHot = countInRing(initialsImage, initialsCentre, (initialsRect.width / 2) * (initialsImage.width / (initialsRect.width + 16)), 0, 0.55, isEmber);
  ok(initialsHot < 4, 'the initial-letter avatar keeps its face clear as well', `${initialsHot} hot pixels`);

  const slimeRect = await tab.evaluate(rectExpression('#qa-slime .demo .user-avatar', 4));
  const slimeImage = await shot('slime-xl', { x: slimeRect.x, y: slimeRect.y, width: slimeRect.width, height: slimeRect.height });
  let slimePixels = 0;
  for (let y = Math.floor(slimeImage.height * 0.5); y < slimeImage.height; y++) {
    for (let x = Math.floor(slimeImage.width * 0.5); x < slimeImage.width; x++) {
      if (isGoo(pixel(slimeImage, x, y))) slimePixels += 1;
    }
  }
  ok(slimePixels > 120, 'the slime is visibly standing in the bottom-right corner', `${slimePixels} slime pixels`);

  const coverRect = await tab.evaluate(rectExpression('#qa-cover .profile-cover', 1));
  const coverImage = await shot('cover', coverRect);
  let auroraPixels = 0;
  for (let y = 0; y < coverImage.height; y++) {
    for (let x = 0; x < coverImage.width; x++) if (isAurora(pixel(coverImage, x, y))) auroraPixels += 1;
  }
  ok(auroraPixels > 800, 'the aurora is visible on the cover', `${auroraPixels} aurora pixels`);

  await shot('preview-top', null);

  const deferred = `document.querySelectorAll('.avatar-fx__canvas')[${deferredCanvas}]`;
  await tab.evaluate(`${deferred}.scrollIntoView({block:'center'})`);
  await tab.wait(`__qaCanvasContexts.has(${deferred})`);
  ok(true, 'the deferred drawing context initializes when the canvas scrolls into view');

  // ---- off-screen pause
  await tab.evaluate('scrollTo(0, document.body.scrollHeight)');
  await sleep(700);
  const offscreen = await tab.evaluate('window.__sombraAvatarFx.state()');
  ok(offscreen.visible <= 2, 'scrolling every decorated avatar out of view stops observing it', `visible ${offscreen.visible}`);
  ok(offscreen.animated === 0, 'nothing animates while every decoration is off screen', `animated ${offscreen.animated}`);
  const offFrames = offscreen.frames;
  await sleep(500);
  const stillOff = await tab.evaluate('window.__sombraAvatarFx.state()');
  ok(stillOff.frames === offFrames, 'the rAF loop is cancelled, not just idle', `${offFrames} -> ${stillOff.frames}`);

  await tab.evaluate('scrollTo(0,0)');
  await sleep(700);
  const back = await tab.evaluate('window.__sombraAvatarFx.state()');
  ok(back.animated > 0, 'coming back on screen resumes animation', `animated ${back.animated}`);

  // ---- document.hidden simulation
  await tab.evaluate(`Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));true`);
  await sleep(300);
  const hiddenState = await tab.evaluate('window.__sombraAvatarFx.state()');
  ok(hiddenState.hidden === true, 'hidden document is detected');
  ok(hiddenState.running === false, 'the loop stops when the document is hidden', `running ${hiddenState.running}`);
  const hiddenFrames = hiddenState.frames;
  await sleep(500);
  const hiddenStill = await tab.evaluate('window.__sombraAvatarFx.state()');
  ok(hiddenStill.frames === hiddenFrames, 'no frames are produced while hidden');
  await tab.evaluate(`delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));true`);
  await sleep(700);
  const shown = await tab.evaluate('window.__sombraAvatarFx.state()');
  ok(shown.running === true && shown.frames > hiddenStill.frames, 'showing the document resumes the loop', `${hiddenStill.frames} -> ${shown.frames}`);

  // ---- real picker canvases animate together despite earlier registrations
  const pickerCanvases = '.profile-effects-dialog .avatar-fx__canvas';
  async function canvasPixels(selector = pickerCanvases) {
    return tab.evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(selector)}), canvas => {
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let hash = 2166136261;
      for (const value of pixels) hash = Math.imul(hash ^ value, 16777619);
      return { effect: canvas.dataset.avatarFxEffect, hash, painted: pixels.some(value => value !== 0) };
    })`);
  }
  for (const [target, effects] of [['avatar', ['holy/divine-shield', 'critters/slime']], ['cover', ['scene', 'weather/aurora']]]) {
    await tab.wait('window.__sombraAvatarFx.state().animated === 4');
    await tab.evaluate(`document.querySelector('#qa-${target}-picker').click()`);
    const initial = await until(async () => {
      const pixels = await canvasPixels();
      return pixels.length === effects.length && pixels.every(pixel => pixel.painted) && pixels;
    }, `${target} picker canvases painted`);
    assert.deepEqual(initial.map(pixel => pixel.effect), effects);
    await until(async () => {
      const pixels = await canvasPixels();
      return pixels.length === initial.length && pixels.every((pixel, i) => pixel.hash !== initial[i].hash);
    }, `${target} picker pixels changing in both cards`);
    const competing = await tab.evaluate('window.__sombraAvatarFx.state()');
    ok(competing.visible >= 6 && competing.animated === 4, `${target} picker canvases both change pixels with earlier canvases competing at the four-job cap`, effects.join(', '));
    await shot(`${target}-picker`);
    await tab.evaluate(`document.querySelector('.profile-effects-dialog header button').click()`);
    await tab.wait(`!document.querySelector('.profile-effects-dialog')`);
  }

  // ---- reduced motion in WebView/RDP does not override autoplay
  await tab.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await tab.send('Page.reload', { ignoreCache: true });
  await tab.wait('!!window.__sombraAvatarFx && window.__sombraAvatarFx.state().frames > 0');
  ok(await tab.evaluate("matchMedia('(prefers-reduced-motion: reduce)').matches"), 'the page sees prefers-reduced-motion: reduce');
  for (const target of ['avatar', 'cover']) {
    await tab.wait('window.__sombraAvatarFx.state().animated === 4');
    await tab.evaluate(`document.querySelector('#qa-${target}-picker').click()`);
    const initial = await until(async () => {
      const pixels = await canvasPixels();
      return pixels.length === 2 && pixels.every(pixel => pixel.painted) && pixels;
    }, `${target} reduced-motion picker painted`);
    await until(async () => {
      const pixels = await canvasPixels();
      return pixels.length === initial.length && pixels.every((pixel, i) => pixel.hash !== initial[i].hash);
    }, `${target} picker autoplay under reduced motion`);
    const competing = await tab.evaluate('window.__sombraAvatarFx.state()');
    ok(competing.visible >= 6 && competing.animated === 4, `${target} picker autoplays under reduced motion at the unchanged cap`);
    ok(await tab.evaluate(`!document.querySelector('.profile-effect-play')`), 'the temporary play button is absent');
    await tab.evaluate(`document.querySelector('.profile-effects-dialog header button').click()`);
    await tab.wait(`!document.querySelector('.profile-effects-dialog')`);
  }
  const cardCanvases = '.user-profile .avatar-fx__canvas';
  await tab.wait('window.__sombraAvatarFx.state().animated === 4');
  await tab.evaluate(`document.querySelector('#qa-profile').click()`);
  const initialProfile = await until(async () => {
    const pixels = await canvasPixels(cardCanvases);
    return pixels.length === 2 && pixels.every(pixel => pixel.painted) && pixels;
  }, 'actual profile canvases painted');
  await until(async () => {
    const pixels = await canvasPixels(cardCanvases);
    return pixels.length === 2 && pixels.every((pixel, i) => pixel.hash !== initialProfile[i].hash);
  }, 'actual profile canvases autoplay under reduced motion');
  const profileBudget = await tab.evaluate('window.__sombraAvatarFx.state()');
  ok(profileBudget.visible >= 6 && profileBudget.animated === 4, 'both actual profile canvases autoplay ahead of earlier background registrations without raising the cap');
  await tab.evaluate(`document.querySelector('.user-profile-close').click()`);

  // ---- privacy / errors
  const external = requests.filter((url) => !url.startsWith(origin) && !url.startsWith('data:') && !url.startsWith('blob:'));
  ok(external.length === 0, 'the decoration engine makes no external requests', external.slice(0, 3).join(', '));
  const pageErrors = await tab.evaluate('window.__qaErrors');
  ok(pageErrors.length === 0, 'no page errors', pageErrors.join(' | '));
  ok(consoleErrors.length === 0, 'no console errors', consoleErrors.slice(0, 3).join(' | '));
} catch (error) {
  errors.push(String(error?.stack ?? error));
  process.exitCode = 1;
  if (tab) await shot('failure').catch(() => {});
} finally {
  for (const socket of sockets) socket.close();
  if (chrome) await new Promise((done) => {
    if (chrome.exitCode !== null) return done();
    chrome.once('exit', done);
    chrome.kill();
  });
  if (server) await server.close();
  const result = {
    passed: checks.length,
    checks,
    errors,
    output: out,
    limitations: [
      'Actual UserAvatar/AvatarFrame React source rendered by a local Vite page; synthetic avatar/cover images only',
      'document.hidden and reduced motion are emulated through CDP/JS, not a real minimized window',
      'No backend, persistence, release or production claims',
    ],
  };
  writeFileSync(`${out}/result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
