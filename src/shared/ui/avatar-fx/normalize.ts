// Validation and normalisation of the v1 decoration document. Pure, synchronous and dependency-free so it can
// run on the API response before anything is drawn, and be unit-tested with `node --test`.
//
// Rules: a document is plain JSON — no functions, no URLs, no eval. Unknown effects/anchors/palettes are dropped
// or replaced by the effect's default, numbers are clamped, and the layer list is capped. Nothing here throws.
import {isHexRamp, isPaletteName, type PaletteName} from './palettes.ts';
import {EFFECT_SPECS, effectSupportsTarget, isEffectId} from './presets.ts';
import {
 DECORATION_VERSION,
 DEFAULT_INTENSITY,
 DEFAULT_SCALE,
 DEFAULT_SEED,
 MAX_LAYERS,
 MAX_LAYERS_HARD_LIMIT,
 MAX_SCALE,
 MIN_SCALE,
 type Anchor,
 type AvatarDecoration,
 type DecorationInput,
 type DecorationIssue,
 type DecorationMode,
 type DecorationTarget,
 type EffectId,
 type NormalizeOptions,
 type NormalizeResult,
 type NormalizedLayer,
 type ResolvedPalette
} from './types.ts';

const TARGETS: readonly DecorationTarget[] = ['avatar', 'cover'];
const MODES: readonly DecorationMode[] = ['frame', 'scene'];
const ANCHORS: readonly Anchor[] = ['ring', 'bottom-right', 'bottom-left', 'top-right', 'top-left', 'fill', 'runner'];
const SEED_MAX = 0xffffffff;

function isTarget(value: unknown): value is DecorationTarget {
 return typeof value === 'string' && (TARGETS as readonly string[]).includes(value);
}

function isAnchor(value: unknown): value is Anchor {
 return typeof value === 'string' && (ANCHORS as readonly string[]).includes(value);
}

function isMode(value: unknown): value is DecorationMode {
 return typeof value === 'string' && (MODES as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
 return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clamp(value: number, min: number, max: number): number {
 return value < min ? min : value > max ? max : value;
}

export function normalizeDecoration(input: unknown, options: NormalizeOptions = {}): NormalizeResult {
 try {
  return normalizeUnsafe(input, options);
 } catch {
  // A document with throwing getters/proxies is not plain JSON; refuse it instead of half-reading it.
  return {
   ok: false,
   value: null,
   warnings: [],
   errors: [{code: 'root-not-object', detail: 'unreadable document'}]
  };
 }
}

function normalizeUnsafe(input: unknown, options: NormalizeOptions): NormalizeResult {
 const warnings: DecorationIssue[] = [];
 const errors: DecorationIssue[] = [];

 if (input === undefined || input === null) return {ok: true, value: null, warnings, errors};
 if (!isRecord(input)) {
  return {
   ok: false,
   value: null,
   warnings,
   errors: [{code: 'root-not-object', detail: typeof input}]
  };
 }

 const document = input as DecorationInput;

 if (document.v === undefined) warnings.push({code: 'version-missing'});
 else if (document.v !== DECORATION_VERSION) {
  return {
   ok: false,
   value: null,
   warnings,
   errors: [{code: 'version-unsupported', detail: String(document.v)}]
  };
 }

 let target: DecorationTarget = 'avatar';
 if (isTarget(options.target)) target = options.target;
 else if (isTarget(document.target)) target = document.target;
 else if (document.target !== undefined) {
  warnings.push({code: 'target-unknown', detail: String(document.target)});
 }

 let seed = DEFAULT_SEED;
 if (
  typeof document.seed === 'number' &&
  Number.isInteger(document.seed) &&
  document.seed >= 0 &&
  document.seed <= SEED_MAX
 ) {
  seed = document.seed;
 } else if (document.seed !== undefined) {
  warnings.push({code: 'seed-invalid', detail: String(document.seed)});
 }

 let mode: DecorationMode = 'frame';
 if (document.mode !== undefined) {
  if (isMode(document.mode)) mode = document.mode;
  else warnings.push({code: 'mode-unknown', detail: String(document.mode)});
 }
 if (mode === 'scene' && target !== 'cover') {
  warnings.push({code: 'mode-unsupported', detail: 'scene needs the cover target'});
  mode = 'frame';
 }

 let loop = true;
 if (document.loop !== undefined) {
  if (typeof document.loop === 'boolean') loop = document.loop;
  else warnings.push({code: 'loop-invalid', detail: String(document.loop)});
 }

 if (!Array.isArray(document.layers)) {
  return {ok: false, value: null, warnings, errors: [{code: 'layers-not-array'}]};
 }

 const limit = MAX_LAYERS[target];
 const layers: NormalizedLayer[] = [];
 const cap = Math.min(document.layers.length, MAX_LAYERS_HARD_LIMIT);
 for (let index = 0; index < cap; index++) {
  if (index >= limit) {
   if (index === limit) warnings.push({code: 'layer-truncated', layer: index, detail: `max ${limit} for ${target}`});
   continue;
  }
  const layer = normalizeLayer(document.layers[index], target, mode, index, warnings);
  if (layer) layers.push(layer);
 }
 if (document.layers.length > MAX_LAYERS_HARD_LIMIT) {
  warnings.push({code: 'layer-truncated', detail: `hard cap ${MAX_LAYERS_HARD_LIMIT}`});
 }

 if (layers.length === 0) {
  warnings.push({code: 'no-layers'});
  return {ok: errors.length === 0, value: null, warnings, errors};
 }

 return {
  ok: errors.length === 0,
  value: {v: DECORATION_VERSION, target, mode, loop, seed, layers},
  warnings,
  errors
 };
}

function normalizeLayer(
 raw: unknown,
 target: DecorationTarget,
 mode: DecorationMode,
 index: number,
 warnings: DecorationIssue[]
): NormalizedLayer | null {
 if (!isRecord(raw)) {
  warnings.push({code: 'layer-not-object', layer: index});
  return null;
 }
 const layer = raw as Record<string, unknown>;

 if (!isEffectId(layer.effect)) {
  warnings.push({code: 'effect-unknown', layer: index, detail: String(layer.effect)});
  return null;
 }
 const effect: EffectId = layer.effect;
 const spec = EFFECT_SPECS[effect];
 if (!effectSupportsTarget(effect, target)) {
  warnings.push({code: 'effect-target-mismatch', layer: index, detail: `${effect} on ${target}`});
  return null;
 }
 // The runner is a scene character, never a frame decoration.
 if (effect === 'sombra/runner' && mode !== 'scene') {
  warnings.push({code: 'effect-target-mismatch', layer: index, detail: 'runner needs mode:"scene"'});
  return null;
 }

 const palette = normalizePalette(layer.palette, index, spec.palettes, spec.defaultPalette, warnings);

 let anchor = spec.defaultAnchor[target];
 if (isAnchor(layer.anchor) && (spec.anchors[target] ?? []).includes(layer.anchor)) {
  anchor = layer.anchor;
 } else if (layer.anchor !== undefined) {
  warnings.push({code: 'anchor-unsupported', layer: index, detail: String(layer.anchor)});
 }
 if (anchor === undefined) {
  warnings.push({code: 'anchor-unsupported', layer: index, detail: 'no default anchor'});
  return null;
 }

 const scale = normalizeNumber(layer.scale, MIN_SCALE, MAX_SCALE, DEFAULT_SCALE, index, 'scale-invalid', warnings);
 const intensity = normalizeNumber(layer.intensity, 0, 1, DEFAULT_INTENSITY, index, 'intensity-invalid', warnings);

 return {effect, palette, anchor, scale, intensity, flip: layer.flip === true};
}

function normalizeNumber(
 value: unknown,
 min: number,
 max: number,
 fallback: number,
 index: number,
 code: 'scale-invalid' | 'intensity-invalid',
 warnings: DecorationIssue[]
): number {
 if (value === undefined) return fallback;
 if (typeof value !== 'number' || !Number.isFinite(value)) {
  warnings.push({code, layer: index, detail: String(value)});
  return fallback;
 }
 return clamp(value, min, max);
}

function normalizePalette(
 raw: unknown,
 index: number,
 allowed: readonly PaletteName[],
 fallback: PaletteName,
 warnings: DecorationIssue[]
): ResolvedPalette {
 const named = (name: PaletteName): ResolvedPalette => ({kind: 'named', name});
 const custom = (ramp: string[]): ResolvedPalette => ({kind: 'custom', ramp: ramp.map(entry => entry.toLowerCase())});

 if (raw === undefined || raw === null) return named(fallback);

 if (typeof raw === 'string') {
  if (isPaletteName(raw)) {
   if (allowed.includes(raw)) return named(raw);
   warnings.push({code: 'palette-unsupported', layer: index, detail: raw});
   return named(fallback);
  }
  warnings.push({code: 'palette-unknown', layer: index, detail: raw});
  return named(fallback);
 }

 if (Array.isArray(raw)) {
  if (isHexRamp(raw)) return custom(raw);
  warnings.push({code: 'palette-invalid', layer: index, detail: 'hex ramp 3–12 entries'});
  return named(fallback);
 }

 // Round-trip support: a normalized document may be passed back in.
 if (isRecord(raw) && raw.kind === 'named' && typeof raw.name === 'string' && isPaletteName(raw.name)) {
  if (allowed.includes(raw.name)) return named(raw.name);
  warnings.push({code: 'palette-unsupported', layer: index, detail: raw.name});
  return named(fallback);
 }
 if (isRecord(raw) && raw.kind === 'custom' && isHexRamp(raw.ramp)) return custom(raw.ramp);

 warnings.push({code: 'palette-invalid', layer: index, detail: typeof raw});
 return named(fallback);
}

/** Compact wire form for the API: the normalized document is already plain JSON. */
export function serializeDecoration(value: AvatarDecoration): string {
 return JSON.stringify({
  v: value.v,
  target: value.target,
  mode: value.mode,
  loop: value.loop,
  seed: value.seed,
  layers: value.layers.map(layer => ({
   effect: layer.effect,
   palette: layer.palette.kind === 'named' ? layer.palette.name : layer.palette.ramp,
   anchor: layer.anchor,
   scale: layer.scale,
   intensity: layer.intensity,
   ...(layer.flip ? {flip: true} : {})
  }))
 });
}

/** A stable key for memoising a layer's renderer without depending on object identity (polling replaces objects). */
export function layerKey(layer: NormalizedLayer, target: DecorationTarget, seed: number): string {
 return JSON.stringify([
  target,
  seed,
  layer.effect,
  layer.anchor,
  layer.scale,
  layer.intensity,
  layer.flip,
  layer.palette.kind === 'named' ? layer.palette.name : layer.palette.ramp
 ]);
}

/** The canvas key for a whole scene (one canvas instead of one per layer). */
export function sceneKey(decoration: AvatarDecoration): string {
 return JSON.stringify([
  decoration.target,
  decoration.mode,
  decoration.seed,
  decoration.layers.map(layer => layerKey(layer, decoration.target, decoration.seed))
 ]);
}
