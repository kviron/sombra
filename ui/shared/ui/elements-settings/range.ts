// Upstream assistant-ui Elements, MIT. Commit 076de9eaf1b5f0f1fb6fb359c5e5d68770cae65c.
// https://github.com/assistant-ui/assistant-ui/blob/076de9eaf1b5f0f1fb6fb359c5e5d68770cae65c/packages/ui/src/components/react/assistant-ui/utils/range.ts
//
// Only `clamp` is vendored: the settings panel keeps the canonical temperature
// slider, so the panel's numeric prop still needs the upstream normalization.
// `NaN` is decided first and maps to `min`; for any other value `max` wins on an
// inverted range, which is what lets an empty collection yield none.

/** Constrains a value to `min…max`. */
export function clamp(value: number, min: number, max: number) {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}
