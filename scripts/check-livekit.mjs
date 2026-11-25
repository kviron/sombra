// Runs the real Sombra API and LiveKit against a temporary local group.
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
import {mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

const windows = process.platform === 'win32';
const liveKit = process.env.SOMBRA_LIVEKIT_BIN || (windows ? 'livekit-server.exe' : 'livekit-server');
const api = process.env.SOMBRA_RUST_BIN || resolve('target', 'debug', windows ? 'mines-server.exe' : 'mines-server');
const apiUrl = 'http://127.0.0.1:38479';
const externalUrl = process.env.SOMBRA_TEST_LIVEKIT_URL;
const liveKitUrl = externalUrl ?? 'http://127.0.0.1:17880';
const temp = await realpath(tmpdir());
const dir = await mkdtemp(join(temp, 'sombra-livekit-smoke-'));
const processes = [];
const secret = externalUrl ? process.env.SOMBRA_TEST_LIVEKIT_SECRET : randomBytes(32).toString('hex');
const key = externalUrl ? process.env.SOMBRA_TEST_LIVEKIT_KEY : 'sombra-local-test';
const env = {...process.env, MINES_DATA_DIR: dir, MINES_BIND: '127.0.0.1:38479', MINES_SECURE_COOKIE: '0'};
for (const name of ['MINES_LIVEKIT_ROOM', 'MINES_LIVEKIT_URL', 'MINES_LIVEKIT_KEY', 'MINES_LIVEKIT_SECRET'])
 delete env[name];

function start(bin, args, env) {
 const child = spawn(bin, args, {env, stdio: 'ignore', windowsHide: true});
 const exited = once(child, 'exit');
 exited.catch(() => {});
 processes.push({child, exited});
 return {child, exited};
}

async function waitFor(url, proc) {
 for (let attempt = 0; attempt < 50; attempt++) {
  const response = await Promise.race([
   fetch(url, {signal: AbortSignal.timeout(500)}).catch(() => null),
   proc.exited.then(() => {
    throw new Error(`Local process stopped before ${url} was ready`);
   })
  ]);
  if (response?.ok) return;
  await delay(150);
 }
 throw new Error(`Timed out waiting for ${url}`);
}

async function stop({child, exited}) {
 if (child.pid && child.exitCode === null && child.signalCode === null) child.kill();
 await exited.catch(() => {});
}

async function request(op, params, session) {
 const res = await fetch(`${apiUrl}/api`, {
  method: 'POST',
  headers: {'Content-Type': 'application/json', ...(session ? {Cookie: session} : {})},
  body: JSON.stringify({...params, op})
 });
 const json = await res.json();
 if (!res.ok || !json.data) throw new Error(`Local Sombra operation ${op} failed with ${res.status}`);
 return {data: json.data, session: res.headers.get('set-cookie')?.split(';')[0]};
}

try {
 if (externalUrl) {
  if (!secret || !key || !externalUrl.startsWith('https://'))
   throw new Error('External smoke test requires HTTPS and test credentials');
 } else {
  const config = join(dir, 'livekit.yaml');
  await writeFile(config, `port: 17880\nrtc:\n  tcp_port: 17881\n  udp_port: 17882\nkeys:\n  ${key}: ${secret}\n`);
  const media = start(liveKit, ['--bind', '127.0.0.1', '--node-ip', '127.0.0.1', '--config', config]);
  await waitFor(liveKitUrl, media);
 }
 const initial = start(api, [], env);
 await waitFor(`${apiUrl}/health`, initial);
 const credentials = await readFile(join(dir, 'FIRST-USER.txt'), 'utf8');
 const password = /^Password: (.+)$/m.exec(credentials)?.[1];
 const {session} = await request('login', {email: 'owner@mines.local', password});
 const {data: state} = await request('state', {}, session);
 const {data: channel} = await request(
  'create_channel',
  {group: state.groups[0].id, kind: 'voice', name: 'LiveKit'},
  session
 );
 await stop(initial);
 const backend = start(api, [], {
  ...env,
  MINES_LIVEKIT_ROOM: channel.id,
  MINES_LIVEKIT_URL: liveKitUrl.replace(/^http/, 'ws'),
  MINES_LIVEKIT_KEY: key,
  MINES_LIVEKIT_SECRET: secret
 });
 await waitFor(`${apiUrl}/health`, backend);
 const browser = spawn(process.execPath, ['scripts/check-voice-loopback.mjs'], {
  env: {
   ...env,
   SOMBRA_TEST_LIVEKIT_ROOM: channel.id,
   SOMBRA_TEST_LIVEKIT_API: `${apiUrl}/api`,
   SOMBRA_TEST_LIVEKIT_SESSION: session
  },
  stdio: 'inherit',
  windowsHide: true
 });
 const [code] = await once(browser, 'exit');
 if (code !== 0) process.exitCode = 1;
} finally {
 await Promise.all(processes.map(stop));
 if ((await realpath(dir)) === dir && dir.startsWith(join(temp, 'sombra-livekit-smoke-')))
  await rm(dir, {recursive: true, force: true, maxRetries: 3});
}
