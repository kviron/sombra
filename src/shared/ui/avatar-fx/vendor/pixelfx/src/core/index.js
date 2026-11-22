// pixelfx — MIT License. Vendored unchanged (except this header) from
// patch-gg/pixelfx@5294518ce7c72e48b6100a744596e0acf57f2826 (src/core/index.js); license text in vendor/pixelfx/LICENSE.
// pixelfx core: everything an effect imports comes from here.

export * from "./math.js";
export * from "./color.js";
export * from "./particles.js";
export * from "./shapes.js";
export { Particles, Bits, Lights, Blazes, P, PF, B, GRAVITY, FIRE_RAMP, SMOKE_RAMP, sparkle, flare, band, crystal } from "./sim.js";
export { Painter } from "./painter.js";
export { FONTS, textWidth } from "./font.js";
export { createFrame, clearFrame, createFx, composite, painterFor, resolveOptions } from "./fx.js";
export { stockActor, drawActor, actorAlphaOf, HERO, HERO2, HERO_PAL, DUMMY_PAL } from "./actor.js";
export { backdrop, BACKDROPS } from "./scene.js";
export { createAct, actBounds, actSpan, actTiming, poseAt, lerpPose, Target, STAND, SKINS, posed } from "./act.js";
export { skeleton, posedParts } from "./rig.js";
export { READY } from "./poses.js";
export { chain, shiftKeys, shiftHits } from "./chain.js";
