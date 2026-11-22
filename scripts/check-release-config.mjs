// Проверка конфигурации выпуска и публичного дерева.
//
//   node scripts/check-release-config.mjs [--repo owner/name]
//
// Проверяет:
//   * версия совпадает в Cargo.toml (workspace), src-tauri/tauri.conf.json, package.json и package-lock.json;
//   * канал обновлений — HTTPS, GitHub Releases и (опционально) резервный VPS;
//   * публичный ключ updater — валидный minisign-ключ;
//   * в индексе git нет путей и содержимого с секретами.
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';

const args = process.argv.slice(2);
const repoArg = args.includes('--repo') ? args[args.indexOf('--repo') + 1] : process.env.GITHUB_REPOSITORY || 'kviron/sombra';
const problems = [];
const check = (ok, message) => { if (!ok) problems.push(message); };

const workspace = readFileSync('Cargo.toml', 'utf8');
const cargoVersion = workspace.match(/^\[workspace\.package\][\s\S]*?^version = "([^"]+)"/m)?.[1];
const config = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const versions = {cargo: cargoVersion, tauri: config.version, package: pkg.version, lock: lock.version, lockRoot: lock.packages?.['']?.version};
const unique = new Set(Object.values(versions));
check(unique.size === 1, `версии расходятся: ${JSON.stringify(versions)}`);
check(lock.packages?.['']?.name === pkg.name, `имя пакета в package-lock.json: ${lock.packages?.['']?.name}`);

const updater = config.plugins?.updater;
check(!!updater, 'в tauri.conf.json нет plugins.updater');
const endpoints = updater?.endpoints ?? [];
check(endpoints.length > 0, 'не задан ни один endpoint обновлений');
const githubEndpoint = `https://github.com/${repoArg}/releases/latest/download/latest.json`;
check(endpoints[0] === githubEndpoint, `первый endpoint должен быть ${githubEndpoint}, сейчас ${endpoints[0]}`);
for (const endpoint of endpoints) {
  let url;
  try { url = new URL(endpoint); } catch { problems.push(`endpoint не URL: ${endpoint}`); continue; }
  check(url.protocol === 'https:', `endpoint без HTTPS: ${endpoint}`);
  check(!url.username && !url.password, `в endpoint есть учётные данные: ${endpoint}`);
}
check(updater?.windows?.installMode === 'passive', 'installMode должен быть passive');

const pubkey = Buffer.from(updater?.pubkey ?? '', 'base64').toString('utf8').trim();
const [comment, key] = pubkey.split('\n');
check(comment?.startsWith('untrusted comment:'), 'pubkey не похож на содержимое .pub');
check(Buffer.from(key ?? '', 'base64').length === 42, 'pubkey должен быть 42-байтным minisign-ключом');

// Пути, которые не должны попадать в публичный репозиторий.
const blockedPath = /(^|\/)(release-secrets|data|node_modules|target|dist|release)(\/|$)|(^|\/)(\.env|sombra\.key|FIRST-USER\.txt)$/;
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9_]{30,}/,
  /\bgithub_pat_[A-Za-z0-9_]{50,}/,
  /\bdW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkK/,
];
let scanned = 0;
const tracked = execFileSync('git', ['-c', 'core.quotePath=false', 'ls-files', '-z'], {encoding: 'utf8'}).split('\0').filter(Boolean);
for (const path of tracked) {
  if (blockedPath.test(path)) { problems.push(`в индексе приватный путь: ${path}`); continue; }
  if (/\.(png|jpg|jpeg|ico|icns|wav|woff2?|gif|webp|exe|dll|zip|gz)$/i.test(path)) continue;
  const content = readFileSync(path);
  if (content.length > 2 * 1024 * 1024) continue;
  scanned += 1;
  for (const pattern of secretPatterns) if (pattern.test(content.toString('latin1'))) problems.push(`секрет в ${path}`);
}

if (problems.length) {
  console.error(problems.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`PASS версия ${pkg.version}, канал ${endpoints[0]}, ${scanned} файлов без секретов`);
}
