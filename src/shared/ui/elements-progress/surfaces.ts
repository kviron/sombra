// assistant-ui Elements (MIT), canonical surface tokens; see LICENSE.
// Commit 076de9eaf1b5f0f1fb6fb359c5e5d68770cae65c.
// The shared tokens are already vendored once for Sombra, so this module only
// re-exports the ones the progress elements use and keeps `mono` verbatim.
// `ShimmerLabel` sits in its own `.tsx` module because this file has no JSX.
export {paper, ghostButton} from '../elements-composer/surfaces';

export const mono = 'font-mono text-[11px] tracking-tight';
