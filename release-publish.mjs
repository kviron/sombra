// Публикация выпуска в GitHub Releases: черновик, артефакты, публикация.
//
//   node release-publish.mjs <версия> <файл заметок> <артефакты…>
//
// Токен берётся из менеджера учётных данных git (host github.com) и нигде не печатается.
import {execFileSync} from 'node:child_process';
import {readFileSync, statSync} from 'node:fs';

const REPO = 'kviron/sombra';

function token() {
 const out = execFileSync('git', ['credential', 'fill'], {
  input: 'protocol=https\nhost=github.com\n\n',
  windowsHide: true
 }).toString();
 const match = /^password=(.*)$/m.exec(out);
 if (!match) throw Error('В менеджере учётных данных нет токена GitHub для github.com');
 return match[1].trim();
}

async function api(path, options = {}) {
 const response = await fetch(path.startsWith('http') ? path : `https://api.github.com${path}`, {
  ...options,
  headers: {
   Authorization: `Bearer ${token()}`,
   Accept: 'application/vnd.github+json',
   'X-GitHub-Api-Version': '2022-11-28',
   'User-Agent': 'sombra-release',
   ...(options.body && typeof options.body === 'string' ? {'Content-Type': 'application/json'} : {}),
   ...(options.headers ?? {})
  }
 });
 const text = await response.text();
 let json;
 try {
  json = text ? JSON.parse(text) : null;
 } catch {
  json = text;
 }
 if (!response.ok)
  throw Error(
   `${response.status}: ${typeof json === 'string' ? json.slice(0, 300) : JSON.stringify(json).slice(0, 300)}`
  );
 return json;
}

async function upload(uploadUrl, file, name) {
 const body = readFileSync(file);
 if (!statSync(file).isFile() || !body.length) throw Error(`Пустой артефакт: ${file}`);
 const asset = await api(uploadUrl.replace('{?name,label}', `?name=${encodeURIComponent(name)}`), {
  method: 'POST',
  body,
  headers: {'Content-Type': 'application/octet-stream'}
 });
 console.log('  загружено', name, asset.size, 'байт');
}

const [version, notesFile, ...assets] = process.argv.slice(2);
if (!version || !notesFile || !assets.length)
 throw Error('Usage: node release-publish.mjs <версия> <заметки> <файлы…>');

const tag = `v${version}`;
const existing = await api(`/repos/${REPO}/releases/tags/${tag}`).catch(() => null);
if (existing && !existing.draft) throw Error(`Релиз ${tag} уже опубликован`);
const release =
 existing ??
 (await api(`/repos/${REPO}/releases`, {
  method: 'POST',
  body: JSON.stringify({
   tag_name: tag,
   name: `Sombra ${version}`,
   body: readFileSync(notesFile, 'utf8'),
   draft: true,
   prerelease: false,
   target_commitish: execFileSync('git', ['rev-parse', 'HEAD'], {windowsHide: true}).toString().trim()
  })
 }));
console.log(existing ? 'черновик уже есть:' : 'черновик создан:', release.html_url);

const seen = new Set();
for (const file of assets) {
 const name = file.split(/[\\/]/).pop();
 if (seen.has(name)) continue;
 seen.add(name);
 if (release.assets?.some(asset => asset.name === name)) {
  console.log('  уже есть', name);
  continue;
 }
 await upload(release.upload_url, file, name);
}
const published = await api(`/repos/${REPO}/releases/${release.id}`, {
 method: 'PATCH',
 body: JSON.stringify({draft: false})
});
console.log('опубликован:', published.html_url);
