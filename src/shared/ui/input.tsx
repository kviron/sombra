import * as React from 'react';
import {cn} from '@/shared/lib/utils';

// shadcn/ui Input, using the project's shared tokens.
export function Input({className, type, ...props}: React.ComponentProps<'input'>) {
 return (
  <input
   data-slot="input"
   type={type}
   className={cn(
    'border-input placeholder:text-muted-foreground focus-visible:ring-ring flex h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:ring-1 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50',
    className
   )}
   {...props}
  />
 );
}
