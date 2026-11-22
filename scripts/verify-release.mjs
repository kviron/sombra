// Проверка выпуска обновления: манифест, ключ и подпись установщика.
//
//   node scripts/verify-release.mjs [--tag v0.1.26] [--repo owner/name]
//
// Ключ берётся из src-tauri/tauri.conf.json, поэтому проверяется именно то,
// что увидит updater у пользователя. Подпись Tauri — minisign: "ED" + keyid + sig
// над BLAKE2b-512 установщика, проверяется стандартным ed25519 из Node.
import {createHash, createPublicKey, verify} from 'node:crypto';
import {readFileSync} from 'node:fs';

const argv = process.argv.slice(2);
const arg = name => {
 const index = argv.indexOf(`--${name}`);
 return index === -1 ? undefined : argv[index + 1];
};
const repo = arg('repo') ?? 'kviron/sombra';
const config = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));
const tag = arg('tag');
const manifestUrl = tag
 ? `https://github.com/${repo}/releases/download/${tag}/latest.json`
 : `https://github.com/${repo}/releases/latest/download/latest.json`;

const fail = message => {
 console.error(`FAIL ${message}`);
 process.exitCode = 1;
};

// Ключ из конфига: две строки, вторая — "Ed" + keyid(8) + key(32).
const key = Buffer.from(config.plugins.updater.pubkey, 'base64').toString('utf8').trim().split('\n')[1];
const keyBytes = Buffer.from(key, 'base64');
if (keyBytes.length !== 42) fail('публичный ключ в tauri.conf.json не 42 байта');
const keyId = keyBytes.subarray(2, 10);
const publicKey = createPublicKey({
 key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), keyBytes.subarray(10)]),
 format: 'der',
 type: 'spki'
});

const manifest = await (await fetch(manifestUrl)).json();
if (manifest.version !== (tag ?? manifest.version).replace(/^v/, '') && tag)
 fail(`версия ${manifest.version} не совпадает с тегом ${tag}`);
const platform = manifest.platforms['windows-x86_64'] ?? manifest.platforms['windows-x86_64-nsis'];
if (!platform) fail('в манифесте нет windows-x86_64');
if (!platform?.url?.startsWith(`https://github.com/${repo}/releases/download/`))
 fail(`URL не ведёт на релиз GitHub: ${platform?.url}`);

const installer = Buffer.from(await (await fetch(platform.url)).arrayBuffer());
if (installer.length < 1024 * 1024) fail(`установщик подозрительно мал: ${installer.length} байт`);

const signatureText = Buffer.from(platform.signature, 'base64').toString('utf8');
const signatureLine = signatureText.split('\n')[1];
if (!signatureLine) fail('подпись не похожа на minisign');
const signature = Buffer.from(signatureLine, 'base64');
if (signature.subarray(0, 2).toString('latin1') !== 'ED') fail('подпись не в hashed-режиме minisign ("ED")');
if (!signature.subarray(2, 10).equals(keyId)) fail('подпись сделана другим ключом — клиент её отвергнет');
const hash = createHash('blake2b512').update(installer).digest();
const ok = verify(null, hash, publicKey, signature.subarray(10, 74));

const sha = createHash('sha256').update(installer).digest('hex');
console.log(`manifest: ${manifest.version} (${platform.url})`);
console.log(`installer: ${(installer.length / 1024 / 1024).toFixed(2)} МБ, sha256 ${sha.slice(0, 16)}…`);
console.log(`key id: ${keyId.toString('hex').toUpperCase()}`);
if (!ok) fail('подпись установщика не сходится с публичным ключом');
else console.log('PASS подпись установщика совпадает с ключом клиента');
