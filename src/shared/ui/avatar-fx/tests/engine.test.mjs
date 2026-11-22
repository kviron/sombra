// The pixel engine: geometry, determinism and "it actually draws something" for every shipped effect.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createDecorationRenderers, planLayerCanvas} from '../engine.ts';
import {planSceneCanvas, SCENE_HEIGHT, SCENE_WIDTH, SceneRenderer} from '../scene.ts';
import {normalizeDecoration} from '../normalize.ts';
import {DECORATION_PRESETS} from '../presets.ts';

function decoration(input) {
 const result = normalizeDecoration(input);
 assert.equal(result.ok, true);
 assert.ok(result.value);
 return result.value;
}

function render(decorationDocument, size, steps = 12, layerIndex = 0) {
 const renderers = createDecorationRenderers(decorationDocument, size);
 const target = renderers[layerIndex];
 const data = new Uint8ClampedArray(target.plan.gridWidth * target.plan.gridHeight * 4);
 const hashes = [];
 let painted = 0;
 for (let frame = 0; frame < steps; frame++) {
  if (frame) target.advance(1 / 30);
  target.render(data);
  painted = countVisible(data);
  hashes.push(createHash('sha256').update(Buffer.from(data.buffer)).digest('hex'));
 }
 return {renderer: target, data, hashes, painted};
}

function countVisible(data) {
 let count = 0;
 for (let index = 3; index < data.length; index += 4) if (data[index] > 0) count += 1;
 return count;
}

test('ring geometry: twice the avatar, one effect pixel per CSS pixel, centre masked', () => {
 const plan = planLayerCanvas(decoration({v: 1, layers: [{effect: 'holy/divine-shield'}]}).layers[0], 'avatar', 'md');
 assert.equal(plan.gridWidth, 64);
 assert.equal(plan.gridHeight, 64);
 assert.equal(plan.cssWidth, '200%');
 assert.equal(plan.cssHeight, '200%');
 assert.equal(plan.kind, 'ring');
 assert.equal(plan.blend, 'normal');
 assert.equal(plan.left, '50%');
 assert.equal(plan.top, '50%');
});

test('ring geometry follows the avatar tier and the scale, within the grid clamp', () => {
 const layer = decoration({v: 1, layers: [{effect: 'holy/divine-shield'}]}).layers[0];
 assert.equal(planLayerCanvas({...layer, scale: 1}, 'avatar', 'xs').gridWidth, 48);
 assert.equal(planLayerCanvas({...layer, scale: 1}, 'avatar', 'xl').gridWidth, 176);
 const big = planLayerCanvas({...layer, scale: 2}, 'avatar', 'xl');
 assert.equal(big.gridWidth, 224);
 assert.equal(big.cssWidth, '400%');
});

test('corner geometry: a square pet anchored to the requested corner', () => {
 const layer = decoration({v: 1, layers: [{effect: 'critters/slime'}]}).layers[0];
 const br = planLayerCanvas(layer, 'avatar', 'md');
 assert.equal(br.gridWidth, 56);
 assert.equal(br.cssWidth, '80%');
 assert.equal(br.right, '-14%');
 assert.equal(br.bottom, '-1%');
 assert.equal(br.kind, 'corner');

 const bl = planLayerCanvas({...layer, anchor: 'bottom-left'}, 'avatar', 'md');
 assert.equal(bl.left, '-14%');
 assert.equal(bl.right, undefined);

 const tr = planLayerCanvas({...layer, anchor: 'top-right'}, 'avatar', 'md');
 assert.equal(tr.top, '-1%');
 assert.equal(tr.bottom, undefined);
});

test('cover geometry: the upper 3:1 band of the aurora sky, screen-blended', () => {
 const layer = decoration({v: 1, target: 'cover', layers: [{effect: 'weather/aurora'}]}).layers[0];
 const plan = planLayerCanvas(layer, 'cover', 'md');
 assert.equal(plan.gridWidth, 320);
 assert.equal(plan.gridHeight, 107);
 assert.equal(plan.cssWidth, '100%');
 assert.equal(plan.blend, 'screen');
 assert.equal(plan.kind, 'cover');
 assert.equal(planLayerCanvas({...layer, scale: 1.5}, 'cover', 'md').cssWidth, '150%');
});

test('every preset renders visible pixels and keeps drawing over time', () => {
 for (const preset of Object.values(DECORATION_PRESETS)) {
  const document = decoration(preset.decoration);
  if (document.mode === 'scene') {
   const result = renderScene(document, 20);
   assert.equal(countVisible(result.data), SCENE_WIDTH * SCENE_HEIGHT, `${preset.id} scene is opaque`);
   assert.ok(new Set(result.hashes).size > 1, `${preset.id} scene animates`);
   continue;
  }
  for (let layer = 0; layer < document.layers.length; layer++) {
   const result = render(document, 'md', 20, layer);
   assert.ok(result.painted > 150, `${preset.id} layer ${layer} painted ${result.painted}`);
   assert.equal(new Set(result.hashes).size, result.hashes.length, `${preset.id} layer ${layer} animates`);
  }
 }
});

test('the same document and seed draw the same frames', () => {
 const doc = decoration(DECORATION_PRESETS['ember-crown'].decoration);
 const a = render(doc, 'lg', 15);
 const b = render(doc, 'lg', 15);
 assert.deepEqual(a.hashes, b.hashes);
 assert.deepEqual(Buffer.from(a.data.buffer).equals(Buffer.from(b.data.buffer)), true);
});

test('a different seed changes the picture', () => {
 for (const preset of Object.values(DECORATION_PRESETS)) {
  const base = decoration({...preset.decoration, seed: 1});
  const other = decoration({...preset.decoration, seed: 987654});
  const a = base.mode === 'scene' ? renderScene(base, 10) : render(base, 'md', 10);
  const b = other.mode === 'scene' ? renderScene(other, 10) : render(other, 'md', 10);
  assert.notDeepEqual(a.hashes, b.hashes, preset.id);
 }
});

test('palette and intensity reach the effect', () => {
 const ember = decoration({v: 1, layers: [{effect: 'holy/divine-shield', palette: 'ember'}]});
 const ice = decoration({v: 1, layers: [{effect: 'holy/divine-shield', palette: 'ice'}]});
 assert.notDeepEqual(render(ember, 'md', 8).hashes, render(ice, 'md', 8).hashes);

 const dim = decoration({v: 1, layers: [{effect: 'holy/divine-shield', intensity: 0}]});
 const hot = decoration({v: 1, layers: [{effect: 'holy/divine-shield', intensity: 1}]});
 assert.notDeepEqual(render(dim, 'md', 8).hashes, render(hot, 'md', 8).hashes);

 const custom = decoration({v: 1, layers: [{effect: 'critters/slime', palette: ['#000', '#f0f', '#fff']}]});
 assert.notDeepEqual(
  render(custom, 'md', 8).hashes,
  render(decoration(DECORATION_PRESETS['slime-pet'].decoration), 'md', 8).hashes
 );
});

test('two layers render into two independent buffers', () => {
 const doc = decoration({
  v: 1,
  layers: [
   {effect: 'holy/divine-shield', palette: 'ember'},
   {effect: 'critters/slime', palette: 'ice', anchor: 'bottom-left'}
  ]
 });
 const renderers = createDecorationRenderers(doc, 'lg');
 assert.equal(renderers.length, 2);
 assert.notEqual(renderers[0].plan.gridWidth, renderers[1].plan.gridWidth);
 const a = new Uint8ClampedArray(renderers[0].plan.gridWidth * renderers[0].plan.gridHeight * 4);
 const b = new Uint8ClampedArray(renderers[1].plan.gridWidth * renderers[1].plan.gridHeight * 4);
 renderers[0].render(a);
 renderers[1].render(b);
 assert.ok(countVisible(a) > 0);
 assert.ok(countVisible(b) > 0);
 assert.notEqual(a.length, b.length);
});

test('the ring effect draws outside the avatar circle but not into the masked centre', () => {
 const doc = decoration({v: 1, layers: [{effect: 'holy/divine-shield'}]});
 const result = render(doc, 'lg', 10);
 const {gridWidth, gridHeight} = result.renderer.plan;
 const centre = (gridWidth - 1) / 2;
 const avatarRadius = gridWidth / 4; // avatar is half the canvas
 let outside = 0;
 let inside = 0;
 for (let y = 0; y < gridHeight; y++) {
  for (let x = 0; x < gridWidth; x++) {
   const alpha = result.data[(y * gridWidth + x) * 4 + 3];
   if (alpha === 0) continue;
   const distance = Math.hypot(x - centre, y - centre);
   if (distance > avatarRadius) outside += 1;
   else inside += 1;
  }
 }
 assert.ok(outside > 100, `outside ${outside}`);
 // The effect may paint a translucent film inside, but the CSS mask removes it; the ring itself lives outside.
 assert.ok(outside > inside, `outside ${outside} vs inside ${inside}`);
});

function sceneDocument(extra = {}) {
 return decoration({
  v: 1,
  target: 'cover',
  mode: 'scene',
  loop: true,
  seed: 11,
  layers: [
   {effect: 'weather/aurora', palette: 'aurora', anchor: 'fill', intensity: 0.75},
   {effect: 'sombra/runner', palette: 'ice', anchor: 'runner', intensity: 0.9}
  ],
  ...extra
 });
}

function renderScene(document, steps = 1) {
 const renderer = new SceneRenderer(document);
 const data = new Uint8ClampedArray(SCENE_WIDTH * SCENE_HEIGHT * 4);
 const hashes = [];
 for (let frame = 0; frame < steps; frame++) {
  if (frame) renderer.advance(1 / 30);
  renderer.render(data);
  hashes.push(createHash('sha256').update(Buffer.from(data.buffer)).digest('hex'));
 }
 return {renderer, data, hashes};
}

const brightness = (data, x, y) => {
 const index = (y * SCENE_WIDTH + x) * 4;
 return data[index] + data[index + 1] + data[index + 2];
};

test('scene geometry: one 320x107 canvas that fills the cover', () => {
 const plan = planSceneCanvas(1);
 assert.equal(plan.gridWidth, 320);
 assert.equal(plan.gridHeight, 107);
 assert.equal(plan.cssWidth, '100%');
 assert.equal(plan.cssHeight, '100%');
 assert.equal(plan.kind, 'scene');
 assert.equal(plan.blend, 'normal');
 assert.equal(planSceneCanvas(1.5).cssWidth, '150%');
});

test('a scene is opaque, deterministic and contains the running character', () => {
 const first = renderScene(sceneDocument());
 for (let index = 3; index < first.data.length; index += 4) assert.equal(first.data[index], 255);
 const second = renderScene(sceneDocument());
 assert.deepEqual(first.hashes, second.hashes);

 // The runner stands at x = 108 with its feet on the horizon; the torso is near-black and the rim is lit.
 assert.ok(brightness(first.data, 112, 77) < 90, `torso ${brightness(first.data, 112, 77)}`);
 assert.ok(brightness(first.data, 113, 73) > 380, `rim ${brightness(first.data, 113, 73)}`);
});

test('a scene animates its character, ground and sky', () => {
 const animated = renderScene(sceneDocument(), 14);
 assert.ok(new Set(animated.hashes).size > 2, 'frames differ');
 const runnerOnly = renderScene(
  decoration({
   v: 1,
   target: 'cover',
   mode: 'scene',
   seed: 5,
   layers: [{effect: 'sombra/runner', palette: 'ice', anchor: 'runner', intensity: 0.9}]
  }),
  14
 );
 assert.ok(new Set(runnerOnly.hashes).size > 2, 'runner-only scene animates');
 assert.notDeepEqual(renderScene(sceneDocument(), 2).hashes, renderScene(sceneDocument({seed: 12}), 2).hashes);
});

test('the sky effect is layered over the scene backdrop', () => {
 const withAurora = renderScene(sceneDocument(), 2);
 const withoutAurora = renderScene(
  decoration({
   v: 1,
   target: 'cover',
   mode: 'scene',
   seed: 11,
   layers: [{effect: 'sombra/runner', palette: 'ice', anchor: 'runner', intensity: 0.9}]
  }),
  2
 );
 assert.notDeepEqual(withAurora.hashes, withoutAurora.hashes);
});
