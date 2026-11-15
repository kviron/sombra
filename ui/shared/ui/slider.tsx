import * as React from 'react';
import {Slider as Primitive} from 'radix-ui';
import {cn} from '@/shared/lib/utils';
export function Slider({className,value,defaultValue=[0],'aria-label':label,...props}:React.ComponentProps<typeof Primitive.Root>){
 return <Primitive.Root data-slot="slider" className={cn('relative flex w-full touch-none select-none items-center data-[disabled]:opacity-50',className)} value={value} defaultValue={defaultValue} {...props}><Primitive.Track data-slot="slider-track" className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-secondary"><Primitive.Range data-slot="slider-range" className="absolute h-full bg-primary"/></Primitive.Track>{(value??defaultValue).map((_,i)=><Primitive.Thumb key={i} aria-label={label} data-slot="slider-thumb" className="block size-4 shrink-0 rounded-full border border-primary bg-background shadow-sm focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/50"/>)}</Primitive.Root>;
}
