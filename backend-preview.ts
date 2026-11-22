import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Plugin, ViteDevServer, PreviewServer } from 'vite';

/**
 * Vite serves the frontend; the API lives in the `sombra-server` binary.
 * Start it on demand so `npm run dev` is a single command.
 */
export function backendPreview(): Plugin {
  const root = fileURLToPath(new URL('.', import.meta.url));
  let child: ChildProcess | undefined;
  let starting: Promise<void> | undefined;
  const ready = async () => {
    try {
      const response = await fetch('http://127.0.0.1:3847/health', { signal: AbortSignal.timeout(500) });
      return response.ok && await response.text() === 'Mines ready';
    } catch { return false; }
  };
  const stop = () => { child?.kill(); child = undefined; };
  const ensureBackend = async () => {
    if (await ready()) return;
    if (!starting) starting = (async () => {
      if (!child || child.exitCode !== null) {
        const executable = fileURLToPath(new URL('./target/debug/mines-server' + (process.platform === 'win32' ? '.exe' : ''), import.meta.url));
        if (!existsSync(executable)) throw new Error('Build the Rust backend first: cargo build -p sombra-server');
        child = spawn(executable, [], { cwd: root, windowsHide: true, stdio: 'ignore', env: { ...process.env, MINES_BIND: '127.0.0.1:3847', MINES_DATA_DIR: fileURLToPath(new URL('./data', import.meta.url)) } });
        child.on('error', stop);
      }
      for (let attempt = 0; attempt < 50; attempt++) {
        if (await ready()) return;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error('Backend did not start');
    })().finally(() => { starting = undefined; });
    await starting;
  };
  const configure = (server: ViteDevServer | PreviewServer) => {
    process.once('exit', stop);
    server.httpServer?.once('close', () => { stop(); process.off('exit', stop); });
    server.middlewares.use('/api', (_request, response, next) => {
      void ensureBackend().then(() => next(), () => {
        response.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: 'Сервер входа недоступен. Перезапустите приложение и попробуйте снова.' }));
      });
    });
  };
  return { name: 'sombra-backend', configureServer: configure, configurePreviewServer: configure };
}
