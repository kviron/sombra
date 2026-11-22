// Upstream assistant-ui Elements, MIT. Commit 076de9eaf1b5f0f1fb6fb359c5e5d68770cae65c.
// https://github.com/assistant-ui/assistant-ui/blob/076de9eaf1b5f0f1fb6fb359c5e5d68770cae65c/packages/ui/src/components/react/assistant-ui/elements/surfaces.tsx
//
// `ShimmerLabel` lives in the upstream `surfaces` module. Sombra keeps the same props and
// the same `shimmer` class contract, but ships the keyframes locally
// (`image-generation.css`) instead of a global theme, so this element is vendored in its
// own module next to its only consumer. Colours come from Sombra's muted foreground.
import type {ComponentProps} from 'react';
import {cn} from '@/shared/lib/utils';

export function ShimmerLabel({active=true,className,...props}:ComponentProps<'span'>&{active?:boolean}){
 return <span data-slot="shimmer-label" className={cn(active&&'elements-shimmer motion-reduce:animate-none',className)} {...props}/>;
}
