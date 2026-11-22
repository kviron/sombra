// The effects a decoration may reference, and the ready-made decorations Sombra offers.
// Each effect id is the upstream pixelfx id; palettes and anchors are the subset that makes sense on a person.
import type {FxEffectModule} from './vendor/pixelfx/bridge.js';
import {aurora, divineShield, slime} from './vendor/pixelfx/effects.js';
import type {PaletteName} from './palettes.ts';
import type {Anchor, DecorationInput, DecorationTarget, EffectId} from './types.ts';

export interface EffectSpec {
 id: EffectId;
 /** `pixelfx` effects come from the vendor tree; `builtin` effects are Sombra's own scene code. */
 kind: 'pixelfx' | 'builtin';
 module?: FxEffectModule;
 targets: readonly DecorationTarget[];
 /** Allowed anchors per target; the first entry of `defaultAnchor[target]` is used when a document is vague. */
 anchors: Readonly<Partial<Record<DecorationTarget, readonly Anchor[]>>>;
 defaultAnchor: Readonly<Partial<Record<DecorationTarget, Anchor>>>;
 defaultPalette: PaletteName;
 palettes: readonly PaletteName[];
}

export const EFFECT_SPECS: Readonly<Record<EffectId, EffectSpec>> = {
 'holy/divine-shield': {
  id: 'holy/divine-shield',
  kind: 'pixelfx',
  module: divineShield,
  targets: ['avatar'],
  anchors: {avatar: ['ring']},
  defaultAnchor: {avatar: 'ring'},
  defaultPalette: 'ember',
  // A barrier recoloured as fire: ember is the default, the rest are recolours of the same ring.
  palettes: ['ember', 'fire', 'lava', 'gold', 'holy', 'arcane', 'ice', 'neon', 'cyber']
 },
 'critters/slime': {
  id: 'critters/slime',
  kind: 'pixelfx',
  module: slime,
  targets: ['avatar'],
  anchors: {avatar: ['bottom-right', 'bottom-left', 'top-right', 'top-left']},
  defaultAnchor: {avatar: 'bottom-right'},
  defaultPalette: 'poison',
  palettes: ['poison', 'heal', 'ice', 'candy', 'arcane', 'gold', 'ember']
 },
 'weather/aurora': {
  id: 'weather/aurora',
  kind: 'pixelfx',
  module: aurora,
  targets: ['cover'],
  anchors: {cover: ['fill']},
  defaultAnchor: {cover: 'fill'},
  defaultPalette: 'aurora',
  palettes: ['aurora', 'leaf', 'ice', 'arcane', 'ember', 'gold', 'neon', 'shadow']
 },
 'sombra/runner': {
  id: 'sombra/runner',
  kind: 'builtin',
  // Sombra's own scene layer: a small side-view runner, scrolling ground and dust. Not from pixelfx.
  targets: ['cover'],
  anchors: {cover: ['runner']},
  defaultAnchor: {cover: 'runner'},
  defaultPalette: 'aurora',
  palettes: ['aurora', 'ice', 'ember', 'gold', 'arcane', 'shadow', 'leaf', 'heal']
 }
};

export function isEffectId(value: unknown): value is EffectId {
 return typeof value === 'string' && Object.prototype.hasOwnProperty.call(EFFECT_SPECS, value);
}

export function effectSupportsTarget(effect: EffectId, target: DecorationTarget): boolean {
 return EFFECT_SPECS[effect].targets.includes(target);
}

/** Effects a `mode:"scene"` cover may use: a sky effect and the built-in runner layer. */
export const SCENE_EFFECTS: readonly EffectId[] = ['weather/aurora', 'sombra/runner'];

export function isSceneEffect(value: EffectId): boolean {
 return SCENE_EFFECTS.includes(value);
}

export type PresetId = 'ember-crown' | 'slime-pet' | 'aurora-cover' | 'runner-cover';

export interface DecorationPreset {
 id: PresetId;
 title: string;
 description: string;
 decoration: DecorationInput;
}

/**
 * What the UI can offer out of the box. These are ordinary v1 documents — a profile stores the document, not
 * the preset id — so a preset can be edited later without a data migration.
 */
export const DECORATION_PRESETS: Readonly<Record<PresetId, DecorationPreset>> = {
 'ember-crown': {
  id: 'ember-crown',
  title: 'Пламенный обод',
  description: 'Огненное кольцо по краю аватара: жар, искры и свет, лицо не перекрыто.',
  decoration: {
   v: 1,
   target: 'avatar',
   seed: 19,
   layers: [{effect: 'holy/divine-shield', palette: 'ember', anchor: 'ring', intensity: 0.9}]
  }
 },
 'slime-pet': {
  id: 'slime-pet',
  title: 'Слайм-питомец',
  description: 'Прыгающий слайм в углу аватара: приседает, прыгает, плюхается и пускает пузыри.',
  decoration: {
   v: 1,
   target: 'avatar',
   seed: 7,
   layers: [{effect: 'critters/slime', palette: 'poison', anchor: 'bottom-right', intensity: 0.85}]
  }
 },
 'aurora-cover': {
  id: 'aurora-cover',
  title: 'Сияние на обложке',
  description: 'Северное сияние поверх обложки профиля: полотна света, звёзды и блики.',
  decoration: {
   v: 1,
   target: 'cover',
   seed: 11,
   layers: [{effect: 'weather/aurora', palette: 'aurora', anchor: 'fill', intensity: 0.8}]
  }
 },
 'runner-cover': {
  id: 'runner-cover',
  title: 'Бегущий по обложке',
  description: 'Вся обложка — зацикленная пиксельная сцена: ночное небо, сияние, холмы и бегущий силуэт.',
  decoration: {
   v: 1,
   target: 'cover',
   mode: 'scene',
   loop: true,
   seed: 11,
   layers: [
    {effect: 'weather/aurora', palette: 'aurora', anchor: 'fill', intensity: 0.75},
    {effect: 'sombra/runner', palette: 'ice', anchor: 'runner', intensity: 0.9}
   ]
  }
 }
};
