#!/usr/bin/env node
// Проверка границ Feature-Sliced Design для src/.
//
// Правила (docs/FRONTEND-STRUCTURE.md):
// 1. Импорт только вниз: app → pages → features → entities → shared.
// 2. Между срезами одного слоя импортов нет.
// 3. Внутрь среза можно попасть только через его index.ts.
// 4. Стили и вложения (.css, .wav, .png, .gif) проверке не подлежат: это глобальные ресурсы.
//
// Запуск: node scripts/check-fsd.mjs (код выхода 1 при нарушении).

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

const SRC = 'src';
const LAYER_ORDER = { shared: 0, entities: 1, features: 2, pages: 3, app: 4 };
const LAYERS = new Set(Object.keys(LAYER_ORDER));
const SLICE_LAYERS = new Set(['pages', 'features', 'entities', 'widgets']);
// Стили подключаются где используются, в том числе из другого слоя.
const ASSET = /\.(css|wav|mp3|png|gif|svg|json|html)$/;

const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir)) {
    if (entry === 'vendor') continue;
    const path = join(dir, entry).split('\\').join('/');
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(path);
  }
  return out;
};

const walkRs = (dir, out = []) => {
  for (const entry of readdirSync(dir)) {
    if (entry === 'target' || entry === 'node_modules') continue;
    const path = join(dir, entry).split('\\').join('/');
    if (statSync(path).isDirectory()) walkRs(path, out);
    else if (entry.endsWith('.rs')) out.push(path);
  }
  return out;
};

// Скрипты, которые запускает Node: только корень репозитория и scripts/.
const walkMjs = (root) =>
  ['.', 'scripts']
    .map((dir) => join(root, dir))
    .filter((dir) => existsSync(dir))
    .flatMap((dir) => readdirSync(dir).filter((entry) => entry.endsWith('.mjs')).map((entry) => join(dir, entry)));

const parts = (path) => path.split('/');
const layerOf = (path) => (parts(path)[0] === SRC ? parts(path)[1] : '');
const sliceOf = (path) => {
  const [, layer, slice] = parts(path);
  return SLICE_LAYERS.has(layer) && slice ? `${layer}/${slice}` : null;
};

const violations = { upward: [], crossSlice: [], bypass: [] };

for (const file of walk(SRC)) {
  const fromLayer = layerOf(file);
  const fromSlice = sliceOf(file);
  if (!LAYERS.has(fromLayer)) continue;
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(/(?:from|import)\s*\(?\s*['"](@\/[^'"]+)['"]/g)) {
    const spec = match[1];
    if (ASSET.test(spec)) continue;
    const target = SRC + '/' + spec.slice(2);
    const toLayer = layerOf(target);
    if (!LAYERS.has(toLayer)) continue;

    const where = `${relative('.', file).split('\\').join('/')} → ${spec}`;
    if (LAYER_ORDER[toLayer] > LAYER_ORDER[fromLayer]) violations.upward.push(where);

    const toSlice = sliceOf(target);
    if (fromSlice && toSlice && fromSlice !== toSlice && fromLayer === toLayer) {
      violations.crossSlice.push(where);
      continue;
    }
    if (toSlice && toSlice !== fromSlice) {
      const rest = target.slice(`${SRC}/${toSlice}`.length);
      // Допустимые точки входа среза: `index.ts` и варианты `index.<окружение>.ts`.
      const isEntryPoint = rest === '' || /^\/index(\.[\w-]+)?$/.test(rest);
      if (!isEntryPoint) violations.bypass.push(where);
    }
  }
}

const titles = {
  upward: 'импорт вверх по слоям (app → pages → features → entities → shared)',
  crossSlice: 'импорт между срезами одного слоя',
  bypass: 'импорт внутрь чужого среза в обход index.ts',
};

// --- пути к файлам, которые не проверяет ни tsc, ни импорт-резолвер ---
// Такой путь при переносе файла ломается молча: звук или картинка просто не загрузится.
const brokenPaths = [];

const existsFile = (p) => {
  try { return statSync(p).isFile(); } catch { return false; }
};

for (const file of walk(SRC)) {
  const source = readFileSync(file, 'utf8');
  // Vite разрешает new URL('./x.wav', import.meta.url) относительно модуля.
  for (const match of source.matchAll(/new URL\(\s*['"](\.[^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g)) {
    const target = join(dirname(file), match[1]);
    if (!existsFile(target)) brokenPaths.push(`${relative('.', file)} → ${match[1]}`);
  }
}
for (const dir of ['src-tauri/src', 'crates']) {
  if (!existsSync(dir)) continue;
  for (const file of walkRs(dir)) {
    const source = readFileSync(file, 'utf8');
    // include_bytes!("../../src/...") считается относительно файла .rs.
    for (const match of source.matchAll(/include_(?:bytes|str)!\(\s*"([^"]+)"\s*\)/g)) {
      const target = join(dirname(file), match[1]);
      if (!existsFile(target)) brokenPaths.push(`${relative('.', file)} → ${match[1]}`);
    }
  }
}
for (const file of walkMjs('.')) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(/from\s*['"](\.\/src\/[^'"]+)['"]/g)) {
    if (!existsFile(join(process.cwd(), match[1]))) brokenPaths.push(`${file} → ${match[1]}`);
  }
}

let failed = false;
for (const [kind, list] of Object.entries(violations)) {
  if (!list.length) continue;
  failed = true;
  console.error(`\n${titles[kind]}: ${list.length}`);
  for (const line of list) console.error('  ' + line);
}
if (brokenPaths.length) {
  failed = true;
  console.error(`\nпуть к файлу не существует: ${brokenPaths.length}`);
  for (const line of brokenPaths) console.error('  ' + line);
}

if (failed) {
  console.error('\nПодробности и правила — docs/FRONTEND-STRUCTURE.md');
  process.exit(1);
}
console.log('FSD: границы слоёв и срезов соблюдены, пути к ассетам целы');
