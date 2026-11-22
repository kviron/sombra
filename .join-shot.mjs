// Joins a voice channel with fake media and screenshots the stage (tiles + participant list).
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9395;
const ORIGIN = 'http://127.0.0.1:1421';
const out = process.argv[2];
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${process.env.TEMP}\\sombra-join-${Date.now()}`,
  '--window-size=1280,800',
  '--no-first-run',
  '--disable-gpu',
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const wsUrl = await (async () => {
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((item) => item.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(200);
  }
  throw new Error('no devtools');
})();
const ws = new WebSocket(wsUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 1;
const pending = new Map();
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result);
  }
};
const send = (method, params = {}) => new Promise((resolve, reject) => { const current = id++; pending.set(current, { resolve, reject }); ws.send(JSON.stringify({ id: current, method, params })); });
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.value;
const waitUntil = async (expression, label, timeout = 25000) => { const started = Date.now(); while (Date.now() - started < timeout) { try { if (await evaluate(expression)) return true; } catch {} await sleep(200); } return false; };

await send('Page.enable');
await send('Runtime.enable');
await send('Browser.grantPermissions', { origin: ORIGIN, permissions: ['audioCapture', 'videoCapture'] }).catch(() => {});
await send('Page.navigate', { url: ORIGIN });
await waitUntil("!!document.querySelector('#email')", 'login');
await evaluate(`(() => { const set=(el,v)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}))}; set(document.querySelector('#email'),'owner@mines.local'); set(document.querySelector('#password'),'Mines-ee41735c-f08e-4ed0'); document.querySelector('form').requestSubmit(); return true; })()`);
await waitUntil("!!document.querySelector('.chat-shell')", 'chat');
await sleep(1500);

// Open the first group in the server rail, then the first channel that shows the voice stage.
await evaluate(`(() => {
  const groups = [...document.querySelectorAll('.server-rail button, aside button')];
  const target = groups.find(el => /^[A-ZА-Я0-9]{1,3}$/.test((el.textContent || '').trim())) || groups[0];
  target?.click();
  return !!target;
})()`);
await sleep(900);
// Click channels one by one until the voice stage appears.
const picked = await evaluate(`(() => {
  const channels = [...document.querySelectorAll('.channel')];
  for (const channel of channels) {
    channel.click();
    return (channel.textContent || '').trim().slice(0, 30);
  }
  return null;
})()`);
console.log('first channel:', picked);
await sleep(900);
if (!(await evaluate("!!document.querySelector('.voice-stage')"))) {
  const count = await evaluate("document.querySelectorAll('.channel').length");
  for (let index = 1; index < (count || 0); index++) {
    await evaluate(`(() => { const c = document.querySelectorAll('.channel')[${index}]; c?.click(); return true; })()`);
    await sleep(700);
    if (await evaluate("!!document.querySelector('.voice-stage')")) break;
  }
}
console.log('voice stage present:', await evaluate("!!document.querySelector('.voice-stage')"));
await sleep(800);
const joined = await evaluate(`(() => {
  const button = [...document.querySelectorAll('button')].find(el => (el.textContent || '').includes('Присоединиться к голосовому каналу'));
  if (!button) return 'no join button';
  button.click();
  return 'clicked';
})()`);
console.log('join:', joined);
const inRoom = await waitUntil("!!document.querySelector('.voice-stage .voice-tile')", 'stage');
console.log('stage rendered:', inRoom);
await sleep(2500);
const state = await evaluate(`(() => {
  const tiles = [...document.querySelectorAll('.voice-stage .voice-tile')];
  const rails = tiles.map(tile => {
    const rail = tile.querySelector('.voice-tile-rail');
    return rail ? getComputedStyle(rail).getPropertyValue('--level').trim() || '0' : 'нет';
  });
  const participants = document.querySelectorAll('.voice-channel-participant').length;
  return JSON.stringify({ tiles: tiles.length, rails, participants, hint: document.querySelector('.voice-stage p')?.textContent?.slice(0, 60) });
})()`);
console.log('state:', state);
if (out) {
  const png = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(out, Buffer.from(png.data, 'base64'));
}
ws.close();
chrome.kill();
