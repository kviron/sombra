import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { once } from 'node:events';
import assert from 'node:assert/strict';
const directory = resolve('deploy-qa/run-' + Date.now());
mkdirSync(directory, { recursive: true });
let child;
async function start() {
  child = spawn(resolve('target/debug/mines-server' + (process.platform === 'win32' ? '.exe' : '')), [], {
    windowsHide: true, stdio: 'ignore',
    env: { ...process.env, MINES_DATA_DIR: directory, MINES_BIND: '127.0.0.1:3859', MINES_SECURE_COOKIE: '1' }
  });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch('http://127.0.0.1:3859/health')).ok) return; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('Server did not start');
}
async function stop() { if(child && child.exitCode === null) { const done = once(child, 'exit'); child.kill(); await done; } }
async function api(op, data = {}, cookie = '') {
  const response = await fetch('http://127.0.0.1:3859/api', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ op, ...data }) });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  return { data: result.data, cookie: response.headers.get('set-cookie') };
}
try {
  await start();
  const a = await api('register', { name: 'Alice', email: 'alice@test.local', password: 'test-password-123' });
  const b = await api('register', { name: 'Boris', email: 'boris@test.local', password: 'test-password-456' });
  assert.match(a.cookie, /HttpOnly.*SameSite=Strict.*Secure/);
  assert.equal(a.data.token, undefined);
  const ac = a.cookie.split(';')[0], bc = b.cookie.split(';')[0];
  const { data: group } = await api('create_group', { name: 'Deployment test' }, ac);
  await api('join_group', { invite: group.invite }, bc);
  const channel = group.channels[0].id;
  await api('message', { channel, text: 'Hello from Alice' }, ac);
  await api('message', { channel, text: 'Hello from Boris' }, bc);
  assert.equal((await api('state', {}, ac)).data.messages.filter(m => m.channel === channel).length, 2);
  await stop(); await start();
  assert.equal((await api('state', {}, bc)).data.messages.filter(m => m.channel === channel).length, 2);
  console.log('PASS: standalone server, two users, shared chat, Secure/HttpOnly cookies, restart persistence');
} finally { await stop(); }

