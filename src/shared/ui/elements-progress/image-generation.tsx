// Upstream assistant-ui Elements, MIT. Commit 076de9eaf1b5f0f1fb6fb359c5e5d68770cae65c.
// https://github.com/assistant-ui/assistant-ui/blob/076de9eaf1b5f0f1fb6fb359c5e5d68770cae65c/packages/ui/src/components/react/assistant-ui/elements/image-generation.tsx
//
// Sombra adaptation (colours, sizes and localization only, plus the documented trims
// below). The canonical anatomy is kept: `data-slot="image-generation"`, the 8×8 dot
// field, the gradient plate that fades in once generation ends, the one-line caption
// and the optional regenerate control.
//  * The image resolution is not part of the bot transport (`state.botTyping` carries no
//    dimensions), so the canonical hard-coded `1024 × 1024` badge is only printed when a
//    caller passes a verified `sizeLabel`. Sombra never invents one.
//  * The prompt text is not part of the bot transport either; the caller passes the
//    bot's own status line as `prompt`. Sombra never invents a prompt.
//  * Labels are Russian: upstream hard-codes "Generating" and "Regenerate image".
//  * `ShimmerLabel` is imported from the vendored Sombra `surfaces` module, which ships
//    the upstream `.shimmer` keyframes locally (`image-generation.css`).
//  * While generating, canonical Elements hides the gradient plate and leaves only the
//    pulsing dot field, which reads as an almost empty dark rectangle in this compact
//    chat. Sombra keeps the dot field on top of a soft breathing gradient with one sheen
//    sweep (`image-generation.css`): visible work, still no percentage or dimensions.
//  * The component is not a live region: the composer dock owns the single polite
//    status announcement for bot activity, so a second one would double-announce.
import type {ComponentProps} from 'react';
import {RefreshCwIcon} from 'lucide-react';
import {cn} from '@/shared/lib/utils';
import {ghostButton, mono, paper} from './surfaces';
import {ShimmerLabel} from './shimmer-label';
import './image-generation.css';

const DOTS = Array.from({length: 64}, (_, i) => i);

export function ImageGeneration({
 prompt,
 generating,
 onRegenerate,
 sizeLabel,
 generatingLabel = 'Генерирую изображение…',
 className,
 ...props
}: Omit<ComponentProps<'div'>, 'children' | 'prompt' | 'generating' | 'onRegenerate'> & {
 /** One short line under the plate; upstream calls it the prompt. */
 prompt: string;
 generating: boolean;
 onRegenerate?: () => void;
 /** Verified dimensions only; omitted when the transport reports none. */
 sizeLabel?: string | undefined;
 /** Localized stand-in used while `prompt` is empty. */
 generatingLabel?: string | undefined;
}) {
 return (
  <div
   data-slot="image-generation"
   data-state={generating ? 'generating' : 'done'}
   aria-busy={generating || undefined}
   className={cn('flex w-52 flex-col gap-2.5', className)}
   {...props}
  >
   <div className={cn(paper, 'relative aspect-square w-full overflow-hidden rounded-2xl')}>
    <div className="absolute inset-0 z-10 grid grid-cols-8 place-items-center p-6" aria-hidden>
     {DOTS.map(dot => {
      const row = Math.floor(dot / 8);
      const col = dot % 8;
      return (
       <span
        key={dot}
        className={cn(
         'bg-foreground/20 size-1 rounded-full transition-opacity duration-500',
         generating ? 'animate-pulse motion-reduce:animate-none' : 'opacity-0'
        )}
        style={{animationDelay: `${(row + col) * 90}ms`}}
       />
      );
     })}
    </div>
    <div
     aria-hidden
     className={cn(
      'absolute inset-0 overflow-hidden transition-[opacity,filter] duration-1000 ease-out motion-reduce:transition-none',
      generating
       ? 'elements-image-plate elements-image-plate-generating opacity-60'
       : 'elements-image-plate blur-0 opacity-100'
     )}
     style={{
      // Sombra palette: indigo → violet → warm highlight, same radial stack.
      background:
       'radial-gradient(120% 90% at 20% 100%, oklch(0.42 0.1 275) 0%, transparent 55%), radial-gradient(110% 80% at 85% 90%, oklch(0.58 0.12 300 / 0.8) 0%, transparent 60%), radial-gradient(130% 100% at 60% 0%, oklch(0.88 0.06 60) 0%, oklch(0.74 0.09 25 / 0.9) 45%, transparent 75%), linear-gradient(to top, oklch(0.33 0.07 280), oklch(0.78 0.08 55))'
     }}
    />
    {sizeLabel ? (
     <span
      className={cn(
       mono,
       'absolute end-2.5 top-2.5 tabular-nums',
       generating ? 'text-muted-foreground' : 'text-white/70'
      )}
     >
      {sizeLabel}
     </span>
    ) : null}
   </div>
   <div className="flex items-center justify-between gap-2">
    <p className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
     {generating ? <ShimmerLabel className="relative">{prompt || generatingLabel}</ShimmerLabel> : prompt}
    </p>
    {onRegenerate && (
     <button
      type="button"
      aria-label="Сгенерировать изображение заново"
      aria-hidden={generating || undefined}
      disabled={generating}
      onClick={onRegenerate}
      className={cn(ghostButton, 'size-6 shrink-0', generating && 'pointer-events-none opacity-0')}
     >
      <RefreshCwIcon className="size-3" />
     </button>
    )}
   </div>
  </div>
 );
}
