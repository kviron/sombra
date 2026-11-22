// Serialisable avatar/cover decoration format (v1) and the normalized, render-ready shape.
// Everything here is plain data: JSON in, JSON-compatible objects out. No functions, no eval, no URLs.
import type {PaletteName} from './palettes.ts';

export const DECORATION_VERSION = 1 as const;

/** Hard caps. The API contract mirrors these so a client cannot be made to render an unbounded document. */
export const MAX_LAYERS = {avatar: 3, cover: 3} as const;
export const MAX_LAYERS_HARD_LIMIT = 8;
export const MIN_SCALE = 0.5;
export const MAX_SCALE = 2;
export const DEFAULT_SCALE = 1;
export const DEFAULT_INTENSITY = 0.8;
export const DEFAULT_SEED = 0;

export type DecorationTarget = 'avatar' | 'cover';
/**
 * `frame` lays effects around/over an avatar or over a cover. `scene` turns the whole cover into a pixel
 * scene: a looping parallax background plus a running character, drawn by code (cover target only).
 */
export type DecorationMode = 'frame' | 'scene';
export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export type EffectId = 'holy/divine-shield' | 'critters/slime' | 'weather/aurora' | 'sombra/runner';
export type Anchor = 'ring' | 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'fill' | 'runner';

/** The wire form: a versioned JSON document. Unknown keys are ignored, never interpreted. */
export interface DecorationLayerInput {
 effect?: unknown;
 palette?: unknown;
 anchor?: unknown;
 scale?: unknown;
 intensity?: unknown;
 flip?: unknown;
}

export interface DecorationInput {
 v?: unknown;
 target?: unknown;
 mode?: unknown;
 loop?: unknown;
 seed?: unknown;
 layers?: unknown;
}

export type ResolvedPalette = {kind: 'named'; name: PaletteName} | {kind: 'custom'; ramp: string[]};

export interface NormalizedLayer {
 effect: EffectId;
 palette: ResolvedPalette;
 anchor: Anchor;
 /** 0.5–2, applied to the canvas size (pixel density stays one effect pixel per CSS pixel where possible). */
 scale: number;
 /** 0–1, drives the glow strength and the overlay opacity. */
 intensity: number;
 /** Mirror the effect horizontally. */
 flip: boolean;
}

export interface AvatarDecoration {
 v: typeof DECORATION_VERSION;
 target: DecorationTarget;
 mode: DecorationMode;
 /** Reserved: every currently supported effect loops; a false value still renders the loop. */
 loop: boolean;
 seed: number;
 layers: NormalizedLayer[];
}

export type DecorationIssueCode =
 | 'root-not-object'
 | 'version-unsupported'
 | 'version-missing'
 | 'target-unknown'
 | 'mode-unknown'
 | 'mode-unsupported'
 | 'loop-invalid'
 | 'seed-invalid'
 | 'layers-not-array'
 | 'layer-not-object'
 | 'layer-truncated'
 | 'effect-unknown'
 | 'effect-target-mismatch'
 | 'anchor-unsupported'
 | 'palette-unknown'
 | 'palette-unsupported'
 | 'palette-invalid'
 | 'scale-invalid'
 | 'intensity-invalid'
 | 'no-layers';

export interface DecorationIssue {
 code: DecorationIssueCode;
 /** Zero-based index in the input layer array, when the issue concerns one layer. */
 layer?: number;
 detail?: string;
}

export interface NormalizeResult {
 /** False only when the document itself is unusable (wrong root, unsupported version, layers not an array). */
 ok: boolean;
 value: AvatarDecoration | null;
 warnings: DecorationIssue[];
 errors: DecorationIssue[];
}

export interface NormalizeOptions {
 /** Force the target instead of trusting `document.target` (the component's own prop wins). */
 target?: DecorationTarget;
}
