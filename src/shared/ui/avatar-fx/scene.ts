// Whole-cover pixel scene: night sky, parallax hills, scrolling ground and a small running silhouette, all
// drawn by code into one 320x107 RGBA grid. A pixelfx sky effect (aurora) can be layered on top of the sky.
//
// The runner is Sombra's own primitive sprite (a side-view silhouette built from 1 px lines and rectangles with
// a 4-step run cycle), because pixelfx has no ready-made running character. It is not vendored: no upstream code
// is copied here.
import {clearFrame, composite, createFx, createFrame} from './vendor/pixelfx/bridge.js';
import type {FxFrame, FxInstance} from './vendor/pixelfx/bridge.js';
import {paletteRamp} from './palettes.ts';
import {EFFECT_SPECS} from './presets.ts';
import type {AvatarDecoration, NormalizedLayer} from './types.ts';
import type {LayerCanvasPlan} from './engine.ts';

export const SCENE_WIDTH = 320;
export const SCENE_HEIGHT = 107;
const HORIZON = 90;
const SCENE_PERIOD = 2.4;
const TAU = Math.PI * 2;

type Rgb = readonly [number, number, number];

const hexToRgb = (value: string): Rgb => {
 const hex = value.replace('#', '');
 const full =
  hex.length === 3
   ? hex
      .split('')
      .map(c => c + c)
      .join('')
   : hex;
 const number = Number.parseInt(full.slice(0, 6), 16);
 return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
};

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
 a[0] + (b[0] - a[0]) * t,
 a[1] + (b[1] - a[1]) * t,
 a[2] + (b[2] - a[2]) * t
];
const shade = (a: Rgb, k: number): Rgb => [a[0] * k, a[1] * k, a[2] * k];

/** Stable per-pixel hash in 0..1; no state, so a scene frame depends only on time and seed. */
function hash2(x: number, y: number, seed: number): number {
 let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1274126177);
 h = Math.imul(h ^ (h >>> 13), 1274126177);
 h ^= h >>> 16;
 return (h >>> 0) / 4294967296;
}

function rampFor(layer: NormalizedLayer): Rgb[] {
 const list = layer.palette.kind === 'named' ? paletteRamp(layer.palette.name) : layer.palette.ramp;
 return list.map(hexToRgb);
}

/** Canvas plan for a scene: one canvas the size of the cover, no blend (the scene is the cover). */
export function planSceneCanvas(scale: number): LayerCanvasPlan {
 return {
  gridWidth: SCENE_WIDTH,
  gridHeight: SCENE_HEIGHT,
  cssWidth: `${100 * scale}%`,
  cssHeight: `${100 * scale}%`,
  left: '50%',
  top: '50%',
  transform: 'translate(-50%, -50%)',
  kind: 'scene',
  blend: 'normal',
  opacity: 1
 };
}

type EffectLayer = {layer: NormalizedLayer; fx: FxInstance; frame: FxFrame; rgba: Uint8ClampedArray};

export class SceneRenderer {
 readonly plan: LayerCanvasPlan;
 private readonly layers: NormalizedLayer[];
 private readonly effects: EffectLayer[] = [];
 private readonly runnerLayer: NormalizedLayer | undefined;
 private readonly palette: Rgb[];
 private readonly seed: number;
 private time = 0;

 constructor(decoration: AvatarDecoration) {
  this.layers = decoration.layers;
  this.seed = decoration.seed;
  this.plan = planSceneCanvas(decoration.layers[0]?.scale ?? 1);
  this.runnerLayer = decoration.layers.find(layer => layer.effect === 'sombra/runner');
  const paletteSource =
   this.runnerLayer ?? decoration.layers.find(layer => layer.effect === 'weather/aurora') ?? decoration.layers[0];
  this.palette = paletteSource ? rampFor(paletteSource) : paletteRamp('aurora').map(hexToRgb);

  for (const layer of decoration.layers) {
   if (layer.effect === 'sombra/runner') continue;
   const spec = EFFECT_SPECS[layer.effect];
   if (!spec.module) continue;
   const frame = createFrame(SCENE_WIDTH, SCENE_HEIGHT);
   const fx = createFx(spec.module, {
    x: SCENE_WIDTH / 2,
    y: 180,
    seed: decoration.seed,
    palette: layer.palette.kind === 'named' ? paletteRamp(layer.palette.name) : [...layer.palette.ramp],
    light: 0.35 + 1.3 * layer.intensity,
    actor: false
   });
   this.effects.push({layer, fx, frame, rgba: new Uint8ClampedArray(SCENE_WIDTH * SCENE_HEIGHT * 4)});
  }
 }

 advance(dt: number): void {
  this.time += dt;
  for (const effect of this.effects) effect.fx.update(dt);
 }

 render(out: Uint8ClampedArray): void {
  this.sky(out);
  for (const effect of this.effects) this.blendEffect(out, effect);
  this.hills(out);
  this.ground(out);
  if (this.runnerLayer) this.runner(out, this.runnerLayer);
  // The scene is opaque: the cover image is not part of it.
  for (let index = 3; index < out.length; index += 4) out[index] = 255;
 }

 private put(out: Uint8ClampedArray, x: number, y: number, color: Rgb, alpha = 1): void {
  if (x < 0 || y < 0 || x >= SCENE_WIDTH || y >= SCENE_HEIGHT || alpha <= 0) return;
  const index = (y * SCENE_WIDTH + x) * 4;
  if (alpha >= 1) {
   out[index] = color[0];
   out[index + 1] = color[1];
   out[index + 2] = color[2];
   return;
  }
  out[index] += (color[0] - out[index]) * alpha;
  out[index + 1] += (color[1] - out[index + 1]) * alpha;
  out[index + 2] += (color[2] - out[index + 2]) * alpha;
 }

 private sky(out: Uint8ClampedArray): void {
  const palette = this.palette;
  const top = mix(palette[0], [4, 5, 11], 0.55);
  const bottom = mix(palette[2], palette[1], 0.4);
  for (let y = 0; y < HORIZON; y++) {
   const t = Math.pow(y / (HORIZON - 1), 0.85);
   for (let x = 0; x < SCENE_WIDTH; x++) {
    this.put(out, x, y, mix(top, bottom, t));
   }
  }
  // stars: tiny steady specks and a few that twinkle; never over the horizon
  for (let y = 2; y < HORIZON - 10; y++) {
   for (let x = 0; x < SCENE_WIDTH; x++) {
    const r = hash2(x, y, this.seed);
    if (r < 0.9953) continue;
    const twinkle = 0.45 + 0.55 * Math.sin(this.time * 2.1 + hash2(x, y, this.seed + 7) * TAU);
    const bright = mix(palette[3], [255, 255, 255], 0.55);
    this.put(out, x, y, shade(bright, 0.35 + 0.65 * twinkle), 0.7);
    if (r > 0.9992) {
     this.put(out, x - 1, y, shade(bright, 0.3), 0.35);
     this.put(out, x + 1, y, shade(bright, 0.3), 0.35);
     this.put(out, x, y - 1, shade(bright, 0.3), 0.35);
    }
   }
  }
  // a wide, low glow at the horizon so the ground does not cut the sky with a hard edge
  for (let y = HORIZON - 26; y < HORIZON; y++) {
   const k = (1 - (HORIZON - y) / 26) * 0.16;
   for (let x = 0; x < SCENE_WIDTH; x++) this.put(out, x, y, palette[4], k);
  }
 }

 private blendEffect(out: Uint8ClampedArray, effect: EffectLayer): void {
  const {frame, rgba, layer} = effect;
  clearFrame(frame);
  effect.fx.draw(frame, 'back');
  effect.fx.draw(frame, 'front');
  composite(frame, rgba, null, 1);
  const opacity = 0.45 + 0.55 * layer.intensity;
  for (let index = 0; index < rgba.length; index += 4) {
   const alpha = (rgba[index + 3] / 255) * opacity;
   if (alpha <= 0.004) continue;
   const screenR = 255 - ((255 - out[index]) * (255 - rgba[index])) / 255;
   const screenG = 255 - ((255 - out[index + 1]) * (255 - rgba[index + 1])) / 255;
   const screenB = 255 - ((255 - out[index + 2]) * (255 - rgba[index + 2])) / 255;
   out[index] += (screenR - out[index]) * alpha;
   out[index + 1] += (screenG - out[index + 1]) * alpha;
   out[index + 2] += (screenB - out[index + 2]) * alpha;
  }
 }

 private hills(out: Uint8ClampedArray): void {
  const palette = this.palette;
  const phase = (this.time / SCENE_PERIOD) * TAU;
  const layers = [
   {
    base: 63,
    amp: 7,
    freq: 0.019,
    cycles: 1,
    color: mix(shade(palette[1], 0.55), [10, 12, 22], 0.45),
    rim: mix(palette[4], [0, 0, 0], 0.35)
   },
   {
    base: 77,
    amp: 9,
    freq: 0.026,
    cycles: 2,
    color: mix(shade(palette[2], 0.42), [7, 8, 16], 0.4),
    rim: mix(palette[4], [255, 255, 255], 0.12)
   }
  ];
  for (const hill of layers) {
   const drift = phase * hill.cycles;
   for (let x = 0; x < SCENE_WIDTH; x++) {
    const top = Math.round(
     hill.base +
      hill.amp * Math.sin(x * hill.freq + drift) +
      hill.amp * 0.45 * Math.sin(x * hill.freq * 2.3 - drift * 1.3 + 1.7)
    );
    for (let y = top; y < HORIZON; y++) this.put(out, x, y, hill.color);
    this.put(out, x, top, hill.rim, 0.55);
    this.put(out, x, top + 1, hill.color);
   }
  }
 }

 private ground(out: Uint8ClampedArray): void {
  const palette = this.palette;
  const base = mix(shade(palette[0], 0.75), [7, 8, 14], 0.5);
  for (let y = HORIZON; y < SCENE_HEIGHT; y++) for (let x = 0; x < SCENE_WIDTH; x++) this.put(out, x, y, base);
  // the lit edge of the road and three lanes of dashes scrolling left
  for (let x = 0; x < SCENE_WIDTH; x++) this.put(out, x, HORIZON, mix(palette[3], [255, 255, 255], 0.15), 0.7);
  const lanes = [
   {y: 95, period: 26, speed: 34, width: 5, color: mix(palette[3], palette[5], 0.35)},
   {y: 100, period: 38, speed: 52, width: 4, color: mix(palette[2], palette[4], 0.3)},
   {y: 105, period: 52, speed: 70, width: 7, color: shade(palette[2], 0.8)}
  ];
  for (const lane of lanes) {
   const offset = (this.time * lane.speed) % lane.period;
   for (let x = -lane.period; x < SCENE_WIDTH + lane.period; x++) {
    if ((x + offset + lane.period) % lane.period > lane.width) continue;
    this.put(out, x, lane.y, lane.color, 0.85);
   }
  }
 }

 private runner(out: Uint8ClampedArray, layer: NormalizedLayer): void {
  const palette = this.palette;
  void layer;
  const body = mix(shade(palette[0], 0.5), [2, 3, 6], 0.5);
  const rim = mix(palette[5], [255, 255, 255], 0.2);
  const scarf = mix(palette[4], [255, 255, 255], 0.1);
  const frame = Math.floor(this.time * 12) % 4;
  const bob = frame === 1 || frame === 3 ? 0 : 1;
  const x = 108;
  const y = HORIZON - bob;
  const line = (x0: number, y0: number, x1: number, y1: number, color: Rgb) => {
   let ax = Math.round(x0);
   let ay = Math.round(y0);
   const bx = Math.round(x1);
   const by = Math.round(y1);
   const dx = Math.abs(bx - ax);
   const dy = -Math.abs(by - ay);
   const sx = ax < bx ? 1 : -1;
   const sy = ay < by ? 1 : -1;
   let err = dx + dy;
   for (;;) {
    this.put(out, ax, ay, color);
    if (ax === bx && ay === by) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
     err += dy;
     ax += sx;
    }
    if (e2 <= dx) {
     err += dx;
     ay += sy;
    }
   }
  };

  // shadow, then the body: head, torso, arms, legs
  for (let dx = -5; dx <= 5; dx++) this.put(out, x + 2 + dx, HORIZON, [0, 0, 0], 0.28 - Math.abs(dx) * 0.03);
  const POSE = [
   {arm: [8, -12, -2, -11], leg: [8, -1, -3, -2]},
   {arm: [6, -9, 1, -9], leg: [4, -1, 1, -2]},
   {arm: [-1, -12, 7, -12], leg: [-2, -2, 7, -1]},
   {arm: [5, -9, 2, -9], leg: [3, -1, 1, -1]}
  ][frame];
  line(x + 3, y - 13, x + POSE.arm[0], y + POSE.arm[1], rim);
  line(x + 3, y - 13, x + POSE.arm[2], y + POSE.arm[3], body);
  line(x + 3, y - 10, x + POSE.leg[0], y + POSE.leg[1], body);
  line(x + 2, y - 10, x + POSE.leg[2], y + POSE.leg[3], shade(body, 0.8));
  for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) this.put(out, x + 3 + col, y - 17 + row, body);
  for (let row = 0; row < 5; row++) for (let col = 0; col < 3; col++) this.put(out, x + 2 + col, y - 14 + row, body);
  this.put(out, x + 5, y - 16, rim);
  this.put(out, x + 4, y - 14, rim);
  this.put(out, x + 2, y - 10, rim);
  // the scarf streams behind with the run cycle
  const wave = Math.sin(this.time * 9);
  line(x + 2, y - 14, x - 2, y - 15 + Math.round(wave), scarf);
  line(x - 2, y - 15 + Math.round(wave), x - 5, y - 14 + Math.round(wave * 2), scarf);
  // dust kicked up behind the feet
  for (let puff = 0; puff < 3; puff++) {
   const age = (this.time * 5 + puff / 3) % 1;
   const px = x - 6 - age * 10;
   this.put(out, Math.round(px), y - age * 2, mix(palette[4], body, 0.4), (1 - age) * 0.35);
   this.put(out, Math.round(px) + 1, y - age * 2 - 1, mix(palette[5], body, 0.5), (1 - age) * 0.2);
  }
 }
}
