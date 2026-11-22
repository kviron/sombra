import {readFileSync, writeFileSync, statSync} from 'node:fs';
const [installer, downloadUrl, notesFile] = process.argv.slice(2);
if (!installer || !downloadUrl)
 throw Error('Usage: node release-manifest.mjs path/to/setup.exe https://host/version/setup.exe [notes.txt]');
const artifact = statSync(installer);
if (!artifact.isFile() || artifact.size === 0) throw Error('Installer must be an existing non-empty file.');
const url = new URL(downloadUrl);
if (url.protocol !== 'https:' || url.username || url.password) throw Error('Installer URL must be public HTTPS.');
const version = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8')).version;
const signature = readFileSync(installer + '.sig', 'utf8').trim();
if (!signature) throw Error('Missing signature.');
const manifest = {
 version,
 notes: notesFile ? readFileSync(notesFile, 'utf8') : 'Новая версия Sombra',
 pub_date: new Date().toISOString(),
 platforms: {'windows-x86_64': {url: url.href, signature}}
};
writeFileSync('latest.json', JSON.stringify(manifest, null, 2) + '\n');
console.log('Created latest.json for Windows x64. Publish installer first, then manifest.');
