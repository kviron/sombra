// Names the elements whose computed gap/radius is off the scale.
import { spawn } from 'node:child_process';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9391;
const ORIGIN = 'http://127.0.0.1:1421';
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${process.env.TEMP}\\sombra-audit3-${Date.now()}`, '--window-size=1280,800', '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
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
await sleep(800);

const finder = `(() => {
  const bad = { '6px': [], '7px': [], '2px': [] };
  const panel = document.querySelector('#account-panel');
  for (const el of panel.querySelectorAll('*')) {
    const st = getComputedStyle(el);
    if (st.display === 'none') continue;
    const key = st.gap;
    if (bad[key]) bad[key].push((el.className || el.tagName).toString().slice(0, 42));
  }
  return JSON.stringify(bad);
})()`;

for (const label of ['Учётная запись', 'Голос и видео', 'Данные и память']) {
  await evaluate(`(() => { const b=[...document.querySelectorAll('.settings-sidebar button')].find(x=>x.textContent.trim()===${JSON.stringify(label)}); b?.click(); return !!b; })()`);
  await sleep(700);
  console.log('### ' + label + ' ' + (await evaluate(finder)));
}
ws.close();
chrome.kill();
