import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer, preview } from 'vite';
import ts from 'typescript';

// Exercise the real HTTP proxy, lazy Rust startup, and persisted account.
const credentials = readFileSync('data/FIRST-USER.txt', 'utf8');
const email = credentials.match(/Email: (.+)/)[1].trim();
const password = credentials.match(/Password: (.+)/)[1].trim();
for (const mode of ['dev', 'preview']) {
 for (const remember_me of [false,true]) {
  const server = mode === 'dev'
    ? await createServer({ server: { host: '127.0.0.1', port: 4189, strictPort: true } })
    : await preview({ preview: { host: '127.0.0.1', port: 4189, strictPort: true } });
  if (mode === 'dev') await server.listen();
  try {
    let cookie = "";
    const request = async body => {
      const response = await fetch('http://127.0.0.1:4189/api', { method: 'POST', headers: {'Content-Type':'application/json', Cookie:cookie}, body: JSON.stringify(body) });
      if(response.headers.get("set-cookie")) cookie=response.headers.get("set-cookie").split(";")[0];
      return { status: response.status, body: await response.json(), cookie:response.headers.get("set-cookie") };
    };
    const login = await request({ op: 'login', email, password, remember_me });
    assert.equal(login.status, 200);
    assert.ok(login.body.data.user.id);
    assert.ok(login.cookie.includes("HttpOnly"));
    assert.ok(login.cookie.includes("Max-Age="+(remember_me?31536000:2592000)));
    assert.equal(login.body.data.token, undefined);
    const state = await request({ op: 'state', token: login.body.data.token });
    assert.equal(state.status, 200);
    assert.equal(state.body.data.email, email);
    const invalid = await request({ op: 'login', email, password: 'incorrect-password' });
    assert.equal(invalid.status, 400);
    assert.equal(typeof invalid.body.error, 'string');
    await request({op:'logout'});
    assert.equal((await request({op:'state'})).status,401);
    console.log(mode + ': persisted login, authenticated state, wrong password passed');
  } finally {
    if (mode === 'dev') await server.close();
    else await new Promise(resolve => server.httpServer.close(resolve));
  }
}

}

let source = readFileSync('ui/shared/api/backend.ts', 'utf8')
  .replace("import { invoke, isTauri } from '@tauri-apps/api/core';", "const isTauri = () => false; const invoke = async () => {};");
source = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
globalThis.localStorage = globalThis.sessionStorage = { getItem: () => '', setItem: () => assert.fail('Invalid response must not save a session') };
const client = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
for (const [body, status] of [['',500], ['<html>Unavailable</html>',502], ['null',200], ['{}',200]]) {
  globalThis.fetch = async () => new Response(body, {status});
  await assert.rejects(client.authenticate('login', {}), error => !error.message.includes('JSON') && !error.message.includes('Unexpected'));
}
globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
await assert.rejects(client.api('login'), /Не удалось связаться/);
console.log('Empty, HTML, null, malformed and network responses handled without saving a session');
