// Upstream assistant-ui Elements, MIT. Commit 076de9eaf1b5f0f1fb6fb359c5e5d68770cae65c.
// https://github.com/assistant-ui/assistant-ui/blob/076de9eaf1b5f0f1fb6fb359c5e5d68770cae65c/packages/ui/src/components/react/assistant-ui/elements/typing-indicator.tsx
//
// Sombra relies on the canonical dots and layout. The only local change is the
// `label` prop: upstream hard-codes the English "Assistant is typing" label, and
// Sombra speaks Russian and names the bot that is typing.
import type {ComponentProps} from 'react';
import {cn} from '@/shared/lib/utils';
import {paper} from './surfaces';

const DOT_DELAYS = ['-0.32s', '-0.16s', '0s'];

export function TypingIndicator({
 variant = 'bubble',
 label = 'Сомбра печатает',
 className,
 ...props
}: Omit<ComponentProps<'div'>, 'children' | 'variant' | 'role' | 'aria-label'> & {
 variant?: 'bubble' | 'bare';
 /** Localized accessible name; upstream hard-codes "Assistant is typing". */
 label?: string;
}) {
 const dots = DOT_DELAYS.map(delay => (
  <span
   key={delay}
   aria-hidden
   className="bg-foreground/40 size-1.5 animate-bounce rounded-full motion-reduce:animate-none"
   style={{animationDelay: delay, animationDuration: '1.1s'}}
  />
 ));

 if (variant === 'bare') {
  return (
   <div
    data-slot="typing-indicator"
    data-variant="bare"
    role="status"
    aria-label={label}
    className={cn('flex gap-1', className)}
    {...props}
   >
    {dots}
   </div>
  );
 }

 return (
  <div
   data-slot="typing-indicator"
   data-variant="bubble"
   className={cn(paper, 'w-fit rounded-full px-4 py-3.5', className)}
   {...props}
  >
   <div role="status" aria-label={label} className="flex gap-1">
    {dots}
   </div>
  </div>
 );
}
