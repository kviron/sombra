// Pixel-art avatar/cover decorations (pixelfx, MIT). Client-side engine and v1 document only — persistence is
// the server's job; see README.md for the field contract.
export { AvatarFrame } from './AvatarFrame.tsx';
export type { AvatarFrameProps } from './AvatarFrame.tsx';
export { normalizeDecoration, serializeDecoration, layerKey, sceneKey } from './normalize.ts';
export { DECORATION_PRESETS, EFFECT_SPECS, SCENE_EFFECTS, effectSupportsTarget, isEffectId, isSceneEffect } from './presets.ts';
export type { DecorationPreset, EffectSpec, PresetId } from './presets.ts';
export { NAMED_PALETTES, isPaletteName, isHexRamp, paletteRamp } from './palettes.ts';
export type { PaletteName } from './palettes.ts';
export { AVATAR_PX, DecorationLayerRenderer, createDecorationRenderers, planLayerCanvas } from './engine.ts';
export type { LayerCanvasPlan } from './engine.ts';
export { SceneRenderer, SCENE_HEIGHT, SCENE_WIDTH, planSceneCanvas } from './scene.ts';
export { FX_FPS, MAX_ANIMATED_FX, fxSchedulerState, registerFxJob } from './scheduler.ts';
export type { FxJobHandle, FxJobInput } from './scheduler.ts';
export {
  DECORATION_VERSION,
  DEFAULT_INTENSITY,
  DEFAULT_SCALE,
  DEFAULT_SEED,
  MAX_LAYERS,
  MAX_LAYERS_HARD_LIMIT,
  MAX_SCALE,
  MIN_SCALE,
} from './types.ts';
export type {
  Anchor,
  AvatarDecoration,
  AvatarSize,
  DecorationInput,
  DecorationIssue,
  DecorationIssueCode,
  DecorationLayerInput,
  DecorationMode,
  DecorationTarget,
  EffectId,
  NormalizedLayer,
  NormalizeOptions,
  NormalizeResult,
  ResolvedPalette,
} from './types.ts';
