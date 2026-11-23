// Upstream assistant-ui Elements, MIT. Commit 076de9eaf1b5f0f1fb6fb359c5e5d68770cae65c.
//
// `ShimmerLabel` lives in the upstream `surfaces` module. Sombra keeps the same props and
// the same `shimmer` class contract, but ships the keyframes locally
// (`image-generation.css`) instead of a global theme, so this element is vendored in its
// own module next to its only consumer. Colours come from Sombra's muted foreground.
import type {ComponentProps} from 'react';
import {cn} from '@/shared/lib/utils';

export function ShimmerLabel({active = true, className, ...props}: ComponentProps<'span'> & {active?: boolean}) {
 return (
  <span
   data-slot="shimmer-label"
   className={cn(
    active && [
     'elements-shimmer bg-[linear-gradient(100deg,#8f97aa_20%,#eef1f9_50%,#8f97aa_80%)] [background-size:200%_100%]',
     'bg-clip-text text-transparent [-webkit-text-fill-color:transparent]',
     'animate-[elements-shimmer-sweep_1.9s_linear_infinite] motion-reduce:animate-none'
    ],
    className
   )}
   {...props}
  />
 );
}
