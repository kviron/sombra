import {useRef} from 'react';
import {cn} from '@/shared/lib/utils';
import type {Sticker} from '@/shared/types';
import {useStickerImage} from '../model/use-sticker-image';

export function StickerImage({
 sticker,
 className,
 original = false
}: {
 sticker: Sticker;
 className?: string;
 original?: boolean;
}) {
 const target = useRef<HTMLSpanElement>(null);
 const image = useStickerImage({sticker, target, variant: original ? 'original' : 'thumbnail'});
 return (
  <span
   ref={target}
   data-slot="sticker-image"
   className={cn('relative inline-block size-16 overflow-hidden rounded-md align-middle', className)}
   role="img"
   aria-label={sticker.name}
  >
   {image && (
    <img
     key={image}
     className="peer absolute inset-0 size-full object-contain opacity-0 data-ready:opacity-100"
     src={image}
     alt=""
     draggable={false}
     decoding="async"
     onLoad={event => event.currentTarget.setAttribute('data-ready', '')}
     onError={event => event.currentTarget.removeAttribute('data-ready')}
    />
   )}
   <span
    aria-hidden="true"
    className="bg-muted/60 pointer-events-none absolute inset-1 rounded-[inherit] peer-data-ready:hidden"
   />
  </span>
 );
}
