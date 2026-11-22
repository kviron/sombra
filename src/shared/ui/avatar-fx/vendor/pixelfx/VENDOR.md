# pixelfx (vendored)

Upstream: [patch-gg/pixelfx](https://github.com/patch-gg/pixelfx) — MIT License, `package.json` version `0.3.1`.
Source commit: `5294518ce7c72e48b6100a744596e0acf57f2826` (the `main` tip this slice was taken from).

Only the modules Sombra's avatar/cover decoration engine needs were copied. Every copied file carries a
two-line header naming the commit; the code under it is unchanged. `src/core/index.js` re-exports the whole
core, so all `src/core/*.js` files are present even where a given effect does not use every one of them.

| vendored file | upstream path | bytes | upstream sha256 |
|---|---|---|---|
| `vendor/pixelfx/src/core/act.js` | `src/core/act.js` | 24016 | b4fdeaf8af30c709748bb221c3b3854cc0438f2ce6c6d99f0324e3b3701b9f71 |
| `vendor/pixelfx/src/core/actor.js` | `src/core/actor.js` | 4375 | 5c867a24a88e93520d020b77190f12db265eb8fc357136ce3d92de05e19e63c2 |
| `vendor/pixelfx/src/core/chain.js` | `src/core/chain.js` | 2137 | 5014a0eae326f1855f5e320308ad370dbc342d2f1051df3665866401956bfef9 |
| `vendor/pixelfx/src/core/color.js` | `src/core/color.js` | 5283 | 4e63f3074df7c1e138f721959858d12e4f6ccc2bf4f8e98c576efbae51241e54 |
| `vendor/pixelfx/src/core/font.js` | `src/core/font.js` | 5399 | c094f1d3a9f94478a255f1cc81aa7ccd2c2ba7a97fc1227a29d268acc1f2ec7c |
| `vendor/pixelfx/src/core/fx.js` | `src/core/fx.js` | 5107 | a959c5f7b1c15ba8e07cb26e5b1ccc0bce0aef54ca14cf01f9d6e794cf4e5a0b |
| `vendor/pixelfx/src/core/index.js` | `src/core/index.js` | 908 | ef5966a6365dbbe8a990867b6c7f3fc61922428e5f2e61262a3a430c119bf02d |
| `vendor/pixelfx/src/core/math.js` | `src/core/math.js` | 6102 | da45e1ed43f7d119dd80fbe97c7de2b35b4ea95dea8781671c296ee5942ac0bc |
| `vendor/pixelfx/src/core/painter.js` | `src/core/painter.js` | 16717 | 5b8ada6a25cdf1e63ae3684cc56276c61306558dc0a3a827a6a39ab038f74681 |
| `vendor/pixelfx/src/core/particles.js` | `src/core/particles.js` | 3242 | 867e58baf522278b4aad383c7224c599cff9ba93268b5eac9485a39a3809477b |
| `vendor/pixelfx/src/core/poses.js` | `src/core/poses.js` | 2236 | 829f9b59ac883061afb9e952d6b608363ec7678bd00b026c538046685af88139 |
| `vendor/pixelfx/src/core/rig.js` | `src/core/rig.js` | 28452 | 5af3f455b18f9feb9f060732fb457529c6c76975a309c72171aa4e88b31aa70c |
| `vendor/pixelfx/src/core/scene.js` | `src/core/scene.js` | 1683 | 520a465f771829162dde114880224eb30efbab3cff859cb8a24a28e49d8e198c |
| `vendor/pixelfx/src/core/shapes.js` | `src/core/shapes.js` | 2225 | 3e28f77e25b3083949f083c74304ead6826b7b1da20a658ccb114ab531fc8898 |
| `vendor/pixelfx/src/core/sim.js` | `src/core/sim.js` | 19530 | 517febe05b72de9d07e3596c019b9bb01e1f97a74089a30fa80e9e98849ba4b0 |
| `vendor/pixelfx/src/fx/holy/divine-shield.js` | `src/fx/holy/divine-shield.js` | 6593 | cacb8e765140eb39dcbbfc1d64771037d78dee60b6c4a7053e5cb6f6360ae0c5 |
| `vendor/pixelfx/src/fx/holy/_lib.js` | `src/fx/holy/_lib.js` | 8983 | 6768e3763ff7c5d5294308cb92137319a979ff365881dc3b101f3f2a01e6ec27 |
| `vendor/pixelfx/src/fx/critters/slime.js` | `src/fx/critters/slime.js` | 14135 | 355ade085030897ac55589cc76a4065951d139a6a9142276f637a6c27225b748 |
| `vendor/pixelfx/src/fx/critters/_lib.js` | `src/fx/critters/_lib.js` | 16187 | 168a5d6d7a9c68a6b5eacec49226e81516b51da145229b0a6d03422cee090dd7 |
| `vendor/pixelfx/src/fx/weather/aurora.js` | `src/fx/weather/aurora.js` | 8025 | 0ef659ed7f6103d18b6fe05d11c5a3d3008af0f36b16f1a3df959aa52986d7a5 |
| `vendor/pixelfx/src/fx/weather/_lib.js` | `src/fx/weather/_lib.js` | 14751 | 21ef7ecb43876b21d64e12126db7735d879ed6cdf119a8b17ce1cc0970ce8b84 |

## Why copy instead of npm

pixelfx has no runtime dependencies, ships ES modules and is MIT, so the slice is a plain file copy. This keeps
the app's dependency list and lockfile untouched and pins the exact code that runs.

## Effects included

| effect id | why |
|---|---|
| `holy/divine-shield` | a round bubble whose rim is a perfect circle; recolored with the `ember` palette it reads as a fiery ring around an avatar, and the translucent film never shows because the face is masked out |
| `critters/slime` | a hopping slime with a puddle, eyes and spores — a corner pet that loops forever |
| `weather/aurora` | a wide, calm sky loop for a profile cover |

Other pixelfx fire effects (`fire/fire-ring`, `fire/fire-tornado`, …) were evaluated and rejected for a ring:
they are ground/AoE effects drawn in floor perspective (a squashed ellipse), so around a circular avatar they
degrade into a few sparks at the left and right edges instead of a frame.

## Updating

Re-run the copy script against a new commit and refresh the table above. Do not edit the copied files (apart
from their header) — local changes belong in `avatar-fx/presets.ts` or the engine, not in the vendor tree.
