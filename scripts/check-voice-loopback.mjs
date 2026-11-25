// Local two-endpoint audio smoke test. Set SOMBRA_TEST_BROWSER to a Chromium executable.
import {build} from 'vite';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp, realpath, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

const liveKitRoom = process.env.SOMBRA_TEST_LIVEKIT_ROOM;
const liveKitApi = process.env.SOMBRA_TEST_LIVEKIT_API && new URL(process.env.SOMBRA_TEST_LIVEKIT_API);
const session = process.env.SOMBRA_TEST_LIVEKIT_SESSION;
const turnUrl = process.env.SOMBRA_TEST_TURN_URL;
if (turnUrl && (!/^turn:127\.0\.0\.1:\d+\?transport=(udp|tcp)$/.test(turnUrl) || liveKitRoom))
 throw new Error('TURN smoke test requires a local TURN URL and P2P mode');
if (liveKitRoom && (!liveKitApi || liveKitApi.hostname !== '127.0.0.1' || !session))
 throw new Error('LiveKit loopback requires a local API URL and test session');

const result = await build({
 configFile: false,
 resolve: {alias: {'@/shared/lib/media-devices': resolve('src/shared/lib/media-devices')}},
 publicDir: false,
 logLevel: 'warn',
 plugins: [
  {
   name: 'loopback-only',
   enforce: 'pre',
   resolveId(id) {
    if (id === '@/shared/api' || id === '@/shared/api/diagnostics') return '\0loopback:' + id;
   },
   load(id) {
    if (id === '\0loopback:@/shared/api')
     return `export class ApiConnectionError extends Error {}\nexport const tauri={isTauri:()=>false};\nexport const api={get voice(){return globalThis.voiceTestBackend}};`;
    if (id === '\0loopback:@/shared/api/diagnostics')
     return 'export const recordDesktopDiagnostic=()=>{}, desktopDiagnosticsAvailable=()=>false;';
   }
  }
 ],
 build: {write: false, minify: false, rollupOptions: {input: resolve('scripts/fixtures/voice-loopback.mjs')}}
});
const files = new Map(result.output.map(item => ['/' + item.fileName, item]));
const entry = result.output.find(item => item.isEntry).fileName;
let finish;
const outcome = new Promise(resolve => {
 finish = resolve;
});
const server = createServer(async (req, res) => {
 if (req.method === 'POST' && req.url === '/voice' && liveKitRoom) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  try {
   const {op, ...params} = JSON.parse(Buffer.concat(chunks).toString());
   if (!['voice_join', 'voice_poll', 'voice_leave'].includes(op)) throw new Error('Unexpected voice operation');
   const upstream = await fetch(liveKitApi, {
    method: 'POST',
    headers: {'Content-Type': 'application/json', Cookie: session},
    body: JSON.stringify({...params, op, room: liveKitRoom})
   });
   res.writeHead(upstream.status, {'Content-Type': 'application/json'}).end(await upstream.text());
  } catch (error) {
   res.writeHead(502, {'Content-Type': 'application/json'}).end(JSON.stringify({error: error.message}));
  }
  return;
 }
 if (req.method === 'POST' && req.url === '/result') {
  let body = '';
  for await (const chunk of req) body += chunk;
  res.end();
  try {
   finish(JSON.parse(body));
  } catch {
   finish({ok: false, error: 'Invalid result'});
  }
  return;
 }
 if (req.url === '/') {
  res.setHeader('Content-Type', 'text/html');
  res.end(
   `<body><script>globalThis.voiceLiveKitTest = ${Boolean(liveKitRoom)}; globalThis.voiceTestTurnUrl = ${JSON.stringify(turnUrl)}</script><script type="module" src="/${entry}"></script></body>`
  );
  return;
 }
 const file = files.get(req.url);
 if (!file) {
  res.statusCode = 404;
  res.end();
  return;
 }
 res.setHeader('Content-Type', file.type === 'chunk' ? 'text/javascript' : 'application/octet-stream');
 res.end(file.code ?? file.source);
});
const temp = await realpath(tmpdir());
const profile = await mkdtemp(join(temp, 'sombra-test-voice-'));
let browser, timer;
try {
 await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
 });
 const url = `http://127.0.0.1:${server.address().port}/`;
 browser = spawn(
  process.env.SOMBRA_TEST_BROWSER || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  [
   '--headless',
   '--disable-gpu',
   '--disable-background-networking',
   '--no-first-run',
   '--mute-audio',
   '--autoplay-policy=no-user-gesture-required',
   `--user-data-dir=${profile}`,
   url
  ],
  {stdio: ['ignore', 'ignore', 'inherit']}
 );
 browser.on('error', e => finish({ok: false, error: e.message}));
 browser.once('exit', code => finish({ok: false, error: `Browser exited: ${code}`}));
 timer = setTimeout(() => finish({ok: false, error: 'Timed out waiting for loopback browser'}), 30000);
 const report = await outcome;
 console.log(JSON.stringify(report));
 if (!report.ok) process.exitCode = 1;
} finally {
 clearTimeout(timer);
 if (browser?.pid && browser.exitCode === null) {
  const closed = new Promise(resolve => browser.once('exit', resolve));
  browser.kill();
  await closed;
 }
 server.closeAllConnections();
 server.close();
 if ((await realpath(profile)) === profile && profile.startsWith(join(temp, 'sombra-test-voice-')))
  await rm(profile, {recursive: true, force: true, maxRetries: 3}).catch(() =>
   console.warn('Test browser profile retained:', profile)
  );
}
