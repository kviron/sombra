// Document validation/normalisation: the trust boundary between a profile JSON and the canvas.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {layerKey, normalizeDecoration, serializeDecoration} from '../normalize.ts';

const codes = issues => issues.map(issue => issue.code);

test('a minimal document gets every default', () => {
 const result = normalizeDecoration({v: 1, layers: [{effect: 'critters/slime'}]});
 assert.equal(result.ok, true);
 assert.deepEqual(result.errors, []);
 assert.equal(result.value.target, 'avatar');
 assert.equal(result.value.seed, 0);
 assert.equal(result.value.layers.length, 1);
 const [layer] = result.value.layers;
 assert.equal(layer.effect, 'critters/slime');
 assert.deepEqual(layer.palette, {kind: 'named', name: 'poison'});
 assert.equal(layer.anchor, 'bottom-right');
 assert.equal(layer.scale, 1);
 assert.equal(layer.intensity, 0.8);
 assert.equal(layer.flip, false);
});

test('the shipped presets are all valid', async () => {
 const {DECORATION_PRESETS} = await import('../presets.ts');
 for (const preset of Object.values(DECORATION_PRESETS)) {
  const result = normalizeDecoration(preset.decoration, {target: preset.decoration.target});
  assert.equal(result.ok, true, preset.id);
  assert.equal(result.errors.length, 0, preset.id);
  assert.ok(result.value, preset.id);
  assert.equal(result.value.layers.length, preset.decoration.layers.length, preset.id);
 }
});

test('a round trip through JSON stays the same document', () => {
 const first = normalizeDecoration({
  v: 1,
  target: 'avatar',
  seed: 42,
  layers: [
   {effect: 'holy/divine-shield', palette: 'ember', anchor: 'ring', intensity: 0.9, flip: true},
   {effect: 'critters/slime', palette: ['#000', '#0f0', '#fff'], anchor: 'bottom-left', scale: 1.5}
  ]
 });
 assert.equal(first.ok, true);
 const wire = JSON.parse(serializeDecoration(first.value));
 const second = normalizeDecoration(wire);
 assert.deepEqual(second.value, first.value);
 assert.equal(second.warnings.length, 0);
});

test('unknown effects are dropped, known ones survive', () => {
 const result = normalizeDecoration({
  v: 1,
  layers: [{effect: 'fire/fire-ring'}, {effect: 'critters/slime'}, {effect: 12}]
 });
 assert.equal(result.ok, true);
 assert.deepEqual(codes(result.warnings), ['effect-unknown', 'effect-unknown']);
 assert.deepEqual(
  result.value.layers.map(layer => layer.effect),
  ['critters/slime']
 );
});

test('a document with nothing renderable is refused, not rendered', () => {
 const result = normalizeDecoration({v: 1, layers: [{effect: 'nope/nope'}]});
 assert.equal(result.ok, true);
 assert.equal(result.value, null);
 assert.ok(codes(result.warnings).includes('no-layers'));
});

test('an unsupported version is a hard failure', () => {
 for (const v of [2, 0, '1', null]) {
  const result = normalizeDecoration({v, layers: []});
  assert.equal(result.ok, false);
  assert.equal(result.value, null);
  assert.deepEqual(codes(result.errors), ['version-unsupported']);
 }
});

test('a missing version is tolerated with a warning', () => {
 const result = normalizeDecoration({layers: [{effect: 'critters/slime'}]});
 assert.equal(result.ok, true);
 assert.ok(codes(result.warnings).includes('version-missing'));
});

test('non-JSON roots and non-array layer lists are refused', () => {
 for (const input of ['{"v":1}', 7, [], true]) {
  const result = normalizeDecoration(input);
  assert.equal(result.ok, false);
  assert.equal(result.value, null);
  assert.deepEqual(codes(result.errors), ['root-not-object']);
 }
 const result = normalizeDecoration({v: 1, layers: 'slime'});
 assert.equal(result.ok, false);
 assert.deepEqual(codes(result.errors), ['layers-not-array']);
});

test('throwing getters are refused instead of half-read', () => {
 const hostile = {
  get layers() {
   throw new Error('boom');
  },
  v: 1
 };
 const result = normalizeDecoration(hostile);
 assert.equal(result.ok, false);
 assert.equal(result.value, null);
});

test('layer count is capped per target', () => {
 const layer = {effect: 'critters/slime'};
 const avatar = normalizeDecoration({v: 1, layers: Array(5).fill(layer)});
 assert.equal(avatar.value.layers.length, 3);
 assert.ok(codes(avatar.warnings).includes('layer-truncated'));

 const cover = normalizeDecoration({
  v: 1,
  target: 'cover',
  layers: Array(4).fill({effect: 'weather/aurora'})
 });
 assert.equal(cover.value.layers.length, 3);

 const hard = normalizeDecoration({v: 1, layers: Array(40).fill({effect: 'nope'})});
 assert.equal(hard.value, null);
 assert.ok(codes(hard.warnings).includes('layer-truncated'));
});

test('an anchor the effect cannot use falls back to that effect default', () => {
 const slime = normalizeDecoration({v: 1, layers: [{effect: 'critters/slime', anchor: 'ring'}]});
 assert.equal(slime.value.layers[0].anchor, 'bottom-right');
 assert.ok(codes(slime.warnings).includes('anchor-unsupported'));

 const shield = normalizeDecoration({v: 1, layers: [{effect: 'holy/divine-shield', anchor: 'top-left'}]});
 assert.equal(shield.value.layers[0].anchor, 'ring');
});

test('numbers are clamped, garbage numbers fall back', () => {
 const clamped = normalizeDecoration({
  v: 1,
  layers: [{effect: 'critters/slime', scale: 9, intensity: 5}]
 });
 assert.equal(clamped.value.layers[0].scale, 2);
 assert.equal(clamped.value.layers[0].intensity, 1);

 const low = normalizeDecoration({v: 1, layers: [{effect: 'critters/slime', scale: -4, intensity: -3}]});
 assert.equal(low.value.layers[0].scale, 0.5);
 assert.equal(low.value.layers[0].intensity, 0);

 const bad = normalizeDecoration({
  v: 1,
  layers: [{effect: 'critters/slime', scale: '2', intensity: Number.NaN}]
 });
 assert.equal(bad.value.layers[0].scale, 1);
 assert.equal(bad.value.layers[0].intensity, 0.8);
 assert.deepEqual(codes(bad.warnings), ['scale-invalid', 'intensity-invalid']);
});

test('palettes: allowed names, unsupported names, unknown names and custom ramps', () => {
 const allowed = normalizeDecoration({v: 1, layers: [{effect: 'holy/divine-shield', palette: 'ember'}]});
 assert.deepEqual(allowed.value.layers[0].palette, {kind: 'named', name: 'ember'});

 const unsupported = normalizeDecoration({v: 1, layers: [{effect: 'holy/divine-shield', palette: 'poison'}]});
 assert.deepEqual(unsupported.value.layers[0].palette, {kind: 'named', name: 'ember'});
 assert.ok(codes(unsupported.warnings).includes('palette-unsupported'));

 const unknown = normalizeDecoration({v: 1, layers: [{effect: 'critters/slime', palette: 'rainbow'}]});
 assert.ok(codes(unknown.warnings).includes('palette-unknown'));

 const custom = normalizeDecoration({
  v: 1,
  layers: [{effect: 'critters/slime', palette: ['#ABC', '#0f0', '#FFF']}]
 });
 assert.deepEqual(custom.value.layers[0].palette, {kind: 'custom', ramp: ['#abc', '#0f0', '#fff']});

 for (const palette of [
  ['#000', '#fff'],
  ['#000', 'red', '#fff'],
  [1, 2, 3],
  () => '#000',
  {kind: 'custom', ramp: ['x']}
 ]) {
  const result = normalizeDecoration({v: 1, layers: [{effect: 'critters/slime', palette}]});
  assert.deepEqual(result.value.layers[0].palette, {kind: 'named', name: 'poison'});
  assert.ok(codes(result.warnings).includes('palette-invalid'), String(palette));
 }
});

test('seed must be an unsigned 32-bit integer', () => {
 const good = normalizeDecoration({v: 1, seed: 4294967295, layers: [{effect: 'critters/slime'}]});
 assert.equal(good.value.seed, 4294967295);

 for (const seed of [-1, 1.5, '42', Number.POSITIVE_INFINITY, 4294967296]) {
  const result = normalizeDecoration({v: 1, seed, layers: [{effect: 'critters/slime'}]});
  assert.equal(result.value.seed, 0);
  assert.ok(codes(result.warnings).includes('seed-invalid'), String(seed));
 }
});

test('an effect only runs on the targets it supports', () => {
 const auroraAvatar = normalizeDecoration({v: 1, layers: [{effect: 'weather/aurora'}]});
 assert.equal(auroraAvatar.value, null);
 assert.ok(codes(auroraAvatar.warnings).includes('effect-target-mismatch'));

 const shieldCover = normalizeDecoration({v: 1, target: 'cover', layers: [{effect: 'holy/divine-shield'}]});
 assert.equal(shieldCover.value, null);

 const auroraCover = normalizeDecoration({v: 1, target: 'cover', layers: [{effect: 'weather/aurora'}]});
 assert.equal(auroraCover.value.layers[0].anchor, 'fill');
});

test('the component target overrides the document target', () => {
 const result = normalizeDecoration({v: 1, target: 'avatar', layers: [{effect: 'weather/aurora'}]}, {target: 'cover'});
 assert.equal(result.ok, true);
 assert.equal(result.value.target, 'cover');
 assert.equal(result.value.layers.length, 1);
});

test('flip is strictly boolean', () => {
 const result = normalizeDecoration({
  v: 1,
  layers: [
   {effect: 'critters/slime', flip: true},
   {effect: 'critters/slime', flip: 'yes'}
  ]
 });
 assert.equal(result.value.layers[0].flip, true);
 assert.equal(result.value.layers[1].flip, false);
});

test('the wire form carries no functions and no undefined values', () => {
 const normalized = normalizeDecoration({
  v: 1,
  seed: 3,
  layers: [
   {effect: 'holy/divine-shield', palette: 'ember', anchor: 'ring', scale: 1, intensity: 1},
   {effect: 'critters/slime', anchor: 'bottom-right', flip: true}
  ]
 }).value;
 const wire = serializeDecoration(normalized);
 assert.equal(typeof wire, 'string');
 assert.equal(JSON.parse(wire).layers.length, 2);
 assert.equal(JSON.parse(wire).layers[1].flip, true);
 assert.equal(JSON.parse(wire).layers[0].scale, 1);
 assert.doesNotMatch(wire, /undefined|null/);
});

test('normalized documents are accepted again (palette objects included)', () => {
 const first = normalizeDecoration({v: 1, layers: [{effect: 'weather/aurora', palette: 'ice'}]}, {target: 'cover'});
 const second = normalizeDecoration(first.value, {target: 'cover'});
 assert.deepEqual(second.value, first.value);
});

test('the renderer key follows the drawing fields only', () => {
 const base = normalizeDecoration({v: 1, layers: [{effect: 'critters/slime'}]}).value.layers[0];
 const same = normalizeDecoration({v: 1, layers: [{effect: 'critters/slime'}]}).value.layers[0];
 assert.equal(layerKey(base, 'avatar', 0), layerKey(same, 'avatar', 0));

 const recoloured = normalizeDecoration({v: 1, layers: [{effect: 'critters/slime', palette: 'candy'}]}).value.layers[0];
 assert.notEqual(layerKey(base, 'avatar', 0), layerKey(recoloured, 'avatar', 0));
 assert.notEqual(layerKey(base, 'avatar', 0), layerKey(base, 'avatar', 1));
 assert.notEqual(layerKey(base, 'avatar', 0), layerKey(base, 'cover', 0));
});

test('mode defaults to frame, loop defaults to true', () => {
 const result = normalizeDecoration({v: 1, layers: [{effect: 'critters/slime'}]});
 assert.equal(result.value.mode, 'frame');
 assert.equal(result.value.loop, true);
});

test('a scene cover takes a sky effect and the runner layer', () => {
 const result = normalizeDecoration({
  v: 1,
  target: 'cover',
  mode: 'scene',
  loop: true,
  seed: 5,
  layers: [
   {effect: 'weather/aurora', palette: 'aurora', anchor: 'fill', intensity: 0.75},
   {effect: 'sombra/runner', palette: 'ice', anchor: 'runner', intensity: 0.9}
  ]
 });
 assert.equal(result.ok, true);
 assert.deepEqual(result.errors, []);
 assert.equal(result.value.mode, 'scene');
 assert.equal(result.value.loop, true);
 assert.deepEqual(
  result.value.layers.map(layer => layer.effect),
  ['weather/aurora', 'sombra/runner']
 );
 assert.equal(result.value.layers[1].anchor, 'runner');
 assert.deepEqual(result.value.layers[1].palette, {kind: 'named', name: 'ice'});
});

test('a scene is cover-only and falls back to a frame on an avatar', () => {
 const result = normalizeDecoration({
  v: 1,
  target: 'avatar',
  mode: 'scene',
  layers: [{effect: 'critters/slime'}]
 });
 assert.equal(result.ok, true);
 assert.equal(result.value.mode, 'frame');
 assert.deepEqual(
  result.value.layers.map(layer => layer.effect),
  ['critters/slime']
 );
 assert.ok(codes(result.warnings).includes('mode-unsupported'));
});

test('the runner is only valid inside a scene', () => {
 const frame = normalizeDecoration({
  v: 1,
  target: 'cover',
  layers: [{effect: 'sombra/runner', palette: 'ice', anchor: 'runner'}]
 });
 assert.equal(frame.value, null);
 assert.ok(codes(frame.warnings).includes('effect-target-mismatch'));

 const runnerOnAvatar = normalizeDecoration({v: 1, layers: [{effect: 'sombra/runner'}]});
 assert.equal(runnerOnAvatar.value, null);
});

test('unknown modes and non-boolean loop are warnings with safe defaults', () => {
 const mode = normalizeDecoration({v: 1, mode: 'fullscreen', layers: [{effect: 'critters/slime'}]});
 assert.equal(mode.value.mode, 'frame');
 assert.ok(codes(mode.warnings).includes('mode-unknown'));

 const loop = normalizeDecoration({v: 1, loop: 'yes', layers: [{effect: 'critters/slime'}]});
 assert.equal(loop.value.loop, true);
 assert.ok(codes(loop.warnings).includes('loop-invalid'));
});

test('scene documents survive a wire round trip', () => {
 const first = normalizeDecoration({
  v: 1,
  target: 'cover',
  mode: 'scene',
  loop: true,
  seed: 7,
  layers: [
   {effect: 'weather/aurora', palette: 'ice', anchor: 'fill'},
   {effect: 'sombra/runner', palette: ['#000', '#123', '#fff'], anchor: 'runner'}
  ]
 });
 const wire = JSON.parse(serializeDecoration(first.value));
 assert.equal(wire.mode, 'scene');
 assert.equal(wire.loop, true);
 const second = normalizeDecoration(wire);
 assert.deepEqual(second.value, first.value);
});
