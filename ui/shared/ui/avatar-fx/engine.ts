// The pixel bridge: one decoration layer -> one low-resolution pixelfx frame -> one RGBA buffer.
// No DOM here, so the exact same code runs in the browser and under `node --test`.
import { clearFrame, composite, createFx, createFrame } from './vendor/pixelfx/bridge.js';
import type { FxFrame, FxInstance, FxOptions } from './vendor/pixelfx/bridge.js';
import { paletteRamp } from './palettes.ts';
import { EFFECT_SPECS } from './presets.ts';
import type { AvatarSize, AvatarDecoration, DecorationTarget, NormalizedLayer } from './types.ts';

/** Mirrors the `.user-avatar[data-size]` sizes in ui/app/user.css. Keep the two in step. */
export const AVATAR_PX: Readonly<Record<AvatarSize, number>> = { xs: 20, sm: 24, md: 32, lg: 40, xl: 88 };

/** dvine-shield's own geometry: rim radius 27 in a 96 px frame, bubble centre 22 px above the origin. */
const SHIELD_RADIUS_RATIO = 27 / 96;
const SHIELD_CENTRE_OFFSET = 22;

const SLIME_GRID = 56;
// The slime's puddle is painted on the ground line (local y = 0). Two rows below the origin keep the body's
// feet whole while the puddle is only a thin, feathered line instead of a goo bar under the avatar.
const SLIME_ORIGIN = { x: 28, y: 54 };

/** Aurora draws a fixed 320x180 sky; we show the upper 3:1 band, which is what a profile cover is. */
const AURORA_GRID = { w: 320, h: 107 };
const AURORA_ORIGIN = { x: 160, y: 180 };

const MIN_RING_GRID = 48;
const MAX_RING_GRID = 224;

export interface LayerCanvasPlan {
  /** Backing-store size in effect pixels. */
  gridWidth: number;
  gridHeight: number;
  cssWidth: string;
  cssHeight: string;
  left?: string;
  right?: string;
  top?: string;
  bottom?: string;
  transform?: string;
  /**
   * `ring` masks out the avatar circle so the effect never paints over the face; `corner` fades the canvas
   * edges so a glow cannot show as a rectangle; `cover` fills its parent; `scene` is a whole-cover pixel scene.
   */
  kind: 'ring' | 'corner' | 'cover' | 'scene';
  blend: 'normal' | 'screen';
  opacity: number;
}

function clampGrid(value: number): number {
  return Math.max(MIN_RING_GRID, Math.min(MAX_RING_GRID, Math.round(value)));
}

/**
 * Geometry for one layer. Sizes are percentages of the avatar box (or of the cover), so they follow the
 * `--avatar-size` CSS variable without measuring anything and stay crisp: the backing grid is chosen in
 * effect pixels and the browser scales it with `image-rendering: pixelated`.
 */
export function planLayerCanvas(layer: NormalizedLayer, target: DecorationTarget, size: AvatarSize): LayerCanvasPlan {
  const opacity = 0.72 + 0.28 * layer.intensity;

  if (layer.effect === 'weather/aurora' && target === 'cover') {
    const zoom = 100 * layer.scale;
    return {
      gridWidth: AURORA_GRID.w,
      gridHeight: AURORA_GRID.h,
      cssWidth: `${zoom}%`,
      cssHeight: `${zoom}%`,
      left: '50%',
      top: '50%',
      transform: 'translate(-50%, -50%)',
      kind: 'cover',
      blend: 'screen',
      opacity,
    };
  }

  if (layer.effect === 'critters/slime') {
    const side = `${80 * layer.scale}%`;
    const plan: LayerCanvasPlan = {
      gridWidth: SLIME_GRID,
      gridHeight: SLIME_GRID,
      cssWidth: side,
      cssHeight: side,
      kind: 'corner',
      blend: 'normal',
      opacity,
    };
    if (layer.anchor === 'bottom-left') {
      plan.left = '-14%';
      plan.bottom = '-1%';
    } else if (layer.anchor === 'top-right') {
      plan.right = '-14%';
      plan.top = '-1%';
    } else if (layer.anchor === 'top-left') {
      plan.left = '-14%';
      plan.top = '-1%';
    } else {
      plan.right = '-14%';
      plan.bottom = '-1%';
    }
    return plan;
  }

  // The ring effect (shield) is avatar-only: a canvas twice the avatar, centred, with the avatar circle masked out.
  const grid = clampGrid(2 * AVATAR_PX[size] * layer.scale);
  return {
    gridWidth: grid,
    gridHeight: grid,
    cssWidth: `${200 * layer.scale}%`,
    cssHeight: `${200 * layer.scale}%`,
    left: '50%',
    top: '50%',
    transform: 'translate(-50%, -50%)',
    kind: 'ring',
    blend: 'normal',
    opacity,
  };
}

/** Options that position a specific effect inside its frame (effect-local coordinates). */
function effectOptions(layer: NormalizedLayer, plan: LayerCanvasPlan): Record<string, unknown> {
  if (layer.effect === 'holy/divine-shield') {
    return { x: plan.gridWidth / 2, y: plan.gridHeight / 2 + SHIELD_CENTRE_OFFSET, radius: plan.gridWidth * SHIELD_RADIUS_RATIO };
  }
  if (layer.effect === 'critters/slime') {
    return { x: SLIME_ORIGIN.x, y: SLIME_ORIGIN.y };
  }
  return { x: AURORA_ORIGIN.x, y: AURORA_ORIGIN.y };
}

function paletteFor(layer: NormalizedLayer): string[] {
  return layer.palette.kind === 'named' ? paletteRamp(layer.palette.name) : [...layer.palette.ramp];
}

/** Advances one effect in real time and renders it into an RGBA buffer (an ImageData's data array). */
export class DecorationLayerRenderer {
  readonly plan: LayerCanvasPlan;
  private fx: FxInstance;
  private readonly frame: FxFrame;
  private readonly makeFx: () => FxInstance;
  /**
   * Corner effects have no frame of their own on screen: their glow would tint a rectangle over the avatar.
   * Dimming the additive light there keeps the creature readable and lets the CSS edge feather do the rest.
   */
  private readonly lightK: number;

  constructor(layer: NormalizedLayer, target: DecorationTarget, size: AvatarSize, seed: number) {
    this.plan = planLayerCanvas(layer, target, size);
    const spec = EFFECT_SPECS[layer.effect];
    const module = spec.module;
    if (!module) throw Error(`effect ${layer.effect} has no pixelfx module`);
    const options: Partial<FxOptions> = {
      seed,
      palette: paletteFor(layer),
      flip: layer.flip,
      light: 0.3 + 1.4 * layer.intensity,
      actor: false,
      ...effectOptions(layer, this.plan),
    };
    // A corner canvas has no frame of its own on screen: the slime's wide additive glow would tint a rectangle
    // over the avatar. Keep a breath of it for the spores, and let the CSS edge feather hide the rest.
    this.lightK = layer.effect === 'critters/slime' ? 0.06 + 0.12 * layer.intensity : 1;
    this.makeFx = () => createFx(module, options);
    this.fx = this.makeFx();
    this.frame = createFrame(this.plan.gridWidth, this.plan.gridHeight);
  }

  /** Advance by real seconds. A one-shot effect restarts from its first frame instead of freezing forever. */
  advance(dt: number): void {
    if (!this.fx.meta.loop && this.fx.done()) {
      this.fx = this.makeFx();
      return;
    }
    this.fx.update(dt);
  }

  /** Paint the current instant into `out` (length `gridWidth * gridHeight * 4`). */
  render(out: Uint8ClampedArray): void {
    clearFrame(this.frame);
    this.fx.draw(this.frame, 'back');
    this.fx.draw(this.frame, 'front');
    composite(this.frame, out, null, this.lightK);
  }
}

/** All renderers for one document, in layer order. */
export function createDecorationRenderers(
  decoration: AvatarDecoration,
  size: AvatarSize,
): DecorationLayerRenderer[] {
  return decoration.layers.map((layer) => new DecorationLayerRenderer(layer, decoration.target, size, decoration.seed));
}
