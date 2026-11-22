// Re-measures spacing after normalization and checks the per-participant volume control.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9390;
const ORIGIN = 'http://127.0.0.1:1421';
const shot = process.argv[2];
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${process.env.TEMP}\\sombra-audit2-${Date.now()}`, '--window-size=1280,800', '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
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
const waitUntil = async (expression, label) => { const started = Date.now(); while (Date.now() - started < 30000) { try { if (await evaluate(expression)) return; } catch {} await sleep(150); } throw new Error('timeout ' + label); };

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: ORIGIN });
await waitUntil("!!document.querySelector('#email')", 'login');
await evaluate(`(() => { const set=(el,v)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}))}; set(document.querySelector('#email'),'owner@mines.local'); set(document.querySelector('#password'),'Mines-ee41735c-f08e-4ed0'); document.querySelector('form').requestSubmit(); return true; })()`);
await waitUntil("!!document.querySelector('.chat-shell')", 'chat');
await sleep(1500);
await evaluate("document.querySelector('[title=\"Настройки пользователя\"]')?.click()");
await waitUntil("!!document.querySelector('.account-modal')", 'settings');
await sleep(700);

const probe = `(() => {
  const panel = document.querySelector('#account-panel');
  const paddings = new Set(), gaps = new Set(), radii = new Set();
  for (const el of [panel, ...panel.querySelectorAll('*')]) {
    const st = getComputedStyle(el);
    if (st.display === 'none') continue;
    if (st.padding !== '0px') paddings.add(st.padding);
    if (st.gap !== 'normal' && st.gap !== '0px') gaps.add(st.gap);
    if (st.borderRadius !== '0px') radii.add(st.borderRadius);
  }
  return JSON.stringify({ paddings: [...paddings], gaps: [...gaps], radii: [...radii] });
})()`;

for (const label of ['Учётная запись', 'Активные сеансы', 'Данные и память', 'Голос и видео']) {
  await evaluate(`(() => { const b=[...document.querySelectorAll('.settings-sidebar button')].find(x=>x.textContent.trim()===${JSON.stringify(label)}); b?.click(); return !!b; })()`);
  await sleep(700);
  const data = JSON.parse(await evaluate(probe));
  console.log('### ' + label);
  console.log('   gaps:', (data.gaps || []).join(' | '));
  console.log('   radii:', (data.radii || []).join(' | '));
}

// Per-participant volume: open a voice channel and look for the control.
await evaluate(`(() => {
  const b=[...document.querySelectorAll('.settings-sidebar button')].find(x=>x.textContent.trim()==='Учётная запись');
  b?.click();
  return true;
})()`);
await sleep(400);
await evaluate("document.querySelector('[title=\"Закрыть настройки\"]')?.click()");
await sleep(600);
const voiceChannel = await evaluate(`(() => {
  const el = document.querySelector('.voice-channel .channel') || document.querySelector('.voice-channel');
  el?.click();
  return !!el;
})()`);
await sleep(1200);
const participants = await evaluate(`(() => {
  const list = document.querySelector('.voice-channel-participants');
  return JSON.stringify({ hasList: !!list, items: list ? list.children.length : 0, room: !!document.querySelector('.voice-stage') });
})()`);
console.log('voice channel:', voiceChannel, '| participants:', participants);
if (shot) {
  const png = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(shot, Buffer.from(png.data, 'base64'));
}
ws.close();
chrome.kill();
