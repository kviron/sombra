// Glue (not upstream pixelfx): the slice of the pixelfx core the avatar decoration engine imports.
// The core itself is vendored unchanged from patch-gg/pixelfx@5294518ce7c72e48b6100a744596e0acf57f2826, MIT.
export { createFrame, clearFrame, createFx, composite } from './src/core/index.js';
export { PAL } from './src/core/color.js';
