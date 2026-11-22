// Локальный выпуск: тот же подписанный NSIS, что собирает CI, но на этой машине.
//
//   TAURI_SIGNING_PRIVATE_KEY="$(cat release-secrets/sombra.key)" npm run release:windows
//
// Обычный путь выпуска — тег vX.Y.Z и GitHub Actions (.github/workflows/release.yml).
import {spawnSync} from 'node:child_process';

const key = process.env.TAURI_SIGNING_PRIVATE_KEY?.trim();
if (!key) {
  throw Error('Задайте TAURI_SIGNING_PRIVATE_KEY: без ключа Tauri не подпишет установщик и updater его отвергнет. Ключ — release-secrets/sombra.key.');
}
const check = spawnSync(process.execPath, ['scripts/check-release-config.mjs'], {stdio: 'inherit', windowsHide: true});
if (check.status !== 0) process.exit(check.status ?? 1);
const build = spawnSync(process.execPath, ['node_modules/@tauri-apps/cli/tauri.js', 'build', '--config', 'src-tauri/tauri.release.json'], {stdio: 'inherit', windowsHide: true});
if (build.error) throw build.error;
if (build.status === 0) {
  console.log('\nУстановщик и подпись: target/release/bundle/nsis/');
  console.log('Загрузить в GitHub Release:');
  console.log('  gh release upload v<версия> target/release/bundle/nsis/*.exe target/release/bundle/nsis/*.exe.sig');
  console.log('Манифест latest.json CI собирает сам; для ручного выпуска — node release-manifest.mjs.');
}
process.exitCode = build.status ?? 1;
