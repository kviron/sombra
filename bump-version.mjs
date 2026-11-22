// Bumps the project version in every place the release requires.
import {readFileSync, writeFileSync} from 'node:fs';

const next = (process.argv[2] || '').trim();
const current = JSON.parse(readFileSync('package.json', 'utf8')).version;
if (!/^\d+\.\d+\.\d+$/.test(next)) throw new Error('Usage: node bump-version.mjs <version>');
if (next === current) throw new Error('Version already ' + next);

const cargo = readFileSync('Cargo.toml', 'utf8');
const cargoNext = cargo.replace(/(\[workspace\.package\][\s\S]*?version = ")([^"]+)(")/, (all, head, value, tail) => {
 if (value !== current) throw new Error(`Cargo.toml workspace version is ${value}, package.json is ${current}`);
 return head + next + tail;
});
if (cargoNext === cargo) throw new Error('Cargo.toml workspace version not found');
writeFileSync('Cargo.toml', cargoNext);

const lock = readFileSync('Cargo.lock', 'utf8');
const names = [];
const lockNext = lock.replace(/\[\[package\]\]\nname = "(sombra[a-z-]*)"\nversion = "([^"]+)"/g, (all, name, value) => {
 if (value !== current) throw new Error(`Cargo.lock ${name} is ${value}, expected ${current}`);
 names.push(name);
 return `[[package]]\nname = "${name}"\nversion = "${next}"`;
});
if (!names.length) throw new Error('No workspace crates found in Cargo.lock');
writeFileSync('Cargo.lock', lockNext);

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
pkg.version = next;
writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');

const pkgLock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
pkgLock.version = next;
pkgLock.packages[''].version = next;
writeFileSync('package-lock.json', JSON.stringify(pkgLock, null, 2) + '\n');

const tauri = readFileSync('src-tauri/tauri.conf.json', 'utf8');
const tauriNext = tauri.replace(/("version":\s*")([^"]+)(")/, (all, head, value, tail) => {
 if (value !== current) throw new Error(`tauri.conf.json version is ${value}, expected ${current}`);
 return head + next + tail;
});
writeFileSync('src-tauri/tauri.conf.json', tauriNext);

console.log(
 `${current} → ${next}; обновлены Cargo.toml, Cargo.lock (${names.join(', ')}), package.json, package-lock.json, tauri.conf.json`
);
