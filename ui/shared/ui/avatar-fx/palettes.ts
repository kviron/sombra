// Named palettes for avatar decorations: a dark-to-bright hex ramp, exactly the shape pixelfx effects take.
// Values come from pixelfx's own PAL table (MIT, vendor/pixelfx/src/core/color.js) plus the aurora effect's
// default ramp, which is not in PAL. Only the palettes listed per effect are accepted; anything else falls
// back to that effect's default with a warning.
import { PAL } from './vendor/pixelfx/bridge.js';

/** Aurora's own default ramp (vendor/pixelfx/src/fx/weather/aurora.js meta.options.palette). */
const AURORA = ['#081a1e', '#0d3a36', '#13664e', '#1fa06a', '#3fd88e', '#9af7bf', '#e6fff0'];

export const NAMED_PALETTES = {
  aurora: AURORA,
  ember: PAL.ember,
  fire: PAL.fire,
  lava: PAL.lava,
  gold: PAL.gold,
  holy: PAL.holy,
  arcane: PAL.arcane,
  ice: PAL.ice,
  poison: PAL.poison,
  heal: PAL.heal,
  candy: PAL.candy,
  neon: PAL.neon,
  cyber: PAL.cyber,
  shadow: PAL.shadow,
  leaf: PAL.leaf,
} as const satisfies Record<string, readonly string[]>;

export type PaletteName = keyof typeof NAMED_PALETTES;

export function isPaletteName(value: unknown): value is PaletteName {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(NAMED_PALETTES, value);
}

/** A copy safe to hand to pixelfx (it resamples to the effect's own ramp length itself). */
export function paletteRamp(name: PaletteName): string[] {
  return [...NAMED_PALETTES[name]];
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
export const MIN_RAMP = 3;
export const MAX_RAMP = 12;

/** A custom ramp: 3–12 `#rgb`/`#rrggbb` entries, lowercased, no other syntax. */
export function isHexRamp(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length >= MIN_RAMP &&
    value.length <= MAX_RAMP &&
    value.every((entry) => typeof entry === 'string' && HEX.test(entry))
  );
}
