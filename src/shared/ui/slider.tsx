import * as React from 'react';
import {Slider as Primitive} from 'radix-ui';
import {cn} from '@/shared/lib/utils';
export function Slider({
 className,
 value,
 defaultValue = [0],
 'aria-label': label,
 'aria-valuetext': valueText,
 ...props
}: React.ComponentProps<typeof Primitive.Root>) {
 return (
  <Primitive.Root
   data-slot="slider"
   className={cn('relative flex w-full touch-none items-center select-none data-[disabled]:opacity-50', className)}
   value={value}
   defaultValue={defaultValue}
   {...props}
  >
   <Primitive.Track
    data-slot="slider-track"
    className="bg-secondary relative h-1.5 w-full grow overflow-hidden rounded-full"
   >
    <Primitive.Range data-slot="slider-range" className="bg-primary absolute h-full" />
   </Primitive.Track>
   {(value ?? defaultValue).map((_, i) => (
    <Primitive.Thumb
     key={i}
     aria-label={label}
     aria-valuetext={valueText}
     data-slot="slider-thumb"
     className="border-primary bg-background focus-visible:ring-ring/50 block size-4 shrink-0 rounded-full border shadow-sm focus-visible:ring-4 focus-visible:outline-none"
    />
   ))}
  </Primitive.Root>
 );
}
