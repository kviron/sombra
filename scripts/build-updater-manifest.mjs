// Собирает latest.json для Tauri updater из подписей, снятых с черновика релиза.
//
//   node scripts/build-updater-manifest.mjs --repo owner/name --tag v0.1.26 --version 0.1.26 \
//        --sigs <каталог с *.sig> --notes <файл с телом релиза> --out latest.json
//
// Подпись читается как текст: её создал tauri signer, и updater сверяет её с ключом в tauri.conf.json.
import {readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

const argv = process.argv.slice(2);
const arg = name => {
 const index = argv.indexOf(`--${name}`);
 return index === -1 ? undefined : argv[index + 1];
};

const repo = arg('repo');
const tag = arg('tag');
const version = arg('version');
const sigsDir = arg('sigs');
const notesFile = arg('notes');
const out = arg('out') ?? 'latest.json';
if (!repo || !tag || !version || !sigsDir) {
 throw Error('нужны --repo, --tag, --version и --sigs');
}
if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw Error(`странное имя репозитория: ${repo}`);
if (tag.replace(/^v/, '') !== version) throw Error(`тег ${tag} не совпадает с версией ${version}`);

const platforms = {};
for (const name of readdirSync(sigsDir)) {
 const bundle = name.slice(0, -'.sig'.length);
 if (!name.endsWith('.sig') || !/_x64-setup\.exe$/.test(bundle)) continue;
 // Tauri пишет .sig как base64 от minisign-подписи, и манифест должен отдать ровно эту строку.
 const signature = readFileSync(join(sigsDir, name), 'utf8').trim();
 const decoded = signature.startsWith('untrusted comment:')
  ? signature
  : Buffer.from(signature, 'base64').toString('utf8');
 if (!decoded.startsWith('untrusted comment:')) {
  throw Error(`подпись ${name} не в формате minisign (${signature.slice(0, 40)})`);
 }
 const url = `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(bundle)}`;
 // Tauri ищет windows-x86_64-nsis для NSIS-установщика и windows-x86_64 как общий ключ.
 platforms['windows-x86_64'] = {signature, url};
 platforms['windows-x86_64-nsis'] = {signature, url};
}
if (!platforms['windows-x86_64']) throw Error('в каталоге подписей нет установщика *_x64-setup.exe.sig');

const notes = notesFile
 ? readFileSync(notesFile, 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim()
 : '';
const manifest = {version, notes, pub_date: new Date().toISOString(), platforms};
writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`latest.json ${version}: ${platforms['windows-x86_64'].url}`);
