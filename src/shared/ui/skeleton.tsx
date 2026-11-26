import type {ComponentProps} from 'react';
import {cn} from '@/shared/lib/utils';

export function Skeleton({className, ...props}: ComponentProps<'div'>) {
 return (
  <div
   data-slot="skeleton"
   aria-hidden="true"
   className={cn('bg-muted rounded-md motion-safe:animate-pulse', className)}
   {...props}
  />
 );
}
