import {ScrollArea as ScrollAreaPrimitive} from 'radix-ui';
import type {ReactNode} from 'react';
import {cn} from '@/shared/lib/utils';

export function ScrollArea({children, viewportClassName}: {children: ReactNode; viewportClassName?: string}) {
 return (
  <ScrollAreaPrimitive.Root className="relative overflow-hidden" type="hover">
   <ScrollAreaPrimitive.Viewport className={cn('w-full', viewportClassName)}>{children}</ScrollAreaPrimitive.Viewport>
   <ScrollAreaPrimitive.Scrollbar orientation="vertical" className="flex w-2 touch-none p-px select-none">
    <ScrollAreaPrimitive.Thumb className="relative flex-1 rounded-full bg-[var(--scrollbar-thumb)] hover:bg-[var(--scrollbar-thumb-hover)] active:bg-[var(--scrollbar-thumb-hover)]" />
   </ScrollAreaPrimitive.Scrollbar>
  </ScrollAreaPrimitive.Root>
 );
}
