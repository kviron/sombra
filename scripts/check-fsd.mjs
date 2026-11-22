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

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

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

let failed = false;
for (const [kind, list] of Object.entries(violations)) {
  if (!list.length) continue;
  failed = true;
  console.error(`\n${titles[kind]}: ${list.length}`);
  for (const line of list) console.error('  ' + line);
}

if (failed) {
  console.error('\nПодробности и правила — docs/FRONTEND-STRUCTURE.md');
  process.exit(1);
}
console.log('FSD: границы слоёв и срезов соблюдены');
