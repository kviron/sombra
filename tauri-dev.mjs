import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = fileURLToPath(new URL('.', import.meta.url));
const profile = process.env.WEBVIEW2_USER_DATA_FOLDER || join(tmpdir(), 'mines-tauri-dev-profile');
mkdirSync(profile, { recursive: true });
const child = spawn(process.execPath, ['node_modules/@tauri-apps/cli/tauri.js', 'dev', ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    WEBVIEW2_USER_DATA_FOLDER: profile,
  },
});
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
