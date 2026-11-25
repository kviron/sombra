import {useEffect, type RefObject} from 'react';
import {useStore} from 'zustand';
import type {Sticker} from '@/shared/types';
import {requestStickerImage, stickerImageKey, stickerImageStore, type StickerImageVariant} from './sticker-image-cache';

type Options = {sticker: Sticker; target: RefObject<HTMLElement | null>; variant: StickerImageVariant};

const observed = new WeakMap<Element, () => void>();
let observer: IntersectionObserver | undefined;

function observeSticker(element: Element, load: () => void) {
 if (typeof IntersectionObserver === 'undefined') {
  load();
  return;
 }
 observer ??= new IntersectionObserver(
  entries => {
   for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    observed.get(entry.target)?.();
   }
  },
  {rootMargin: '96px', scrollMargin: '96px'}
 );
 observed.set(element, load);
 observer.observe(element);
 return () => {
  observed.delete(element);
  observer?.unobserve(element);
 };
}

export function useStickerImage({sticker, target, variant}: Options) {
 const key = stickerImageKey(sticker.id, variant);
 const image = useStore(stickerImageStore, state => state.images[key]);

 useEffect(() => {
  if (sticker.image && variant === 'original') return;
  const element = target.current;
  if (!element) return;
  return observeSticker(element, () => {
   if (stickerImageStore.getState().images[key]) return;
   void requestStickerImage(sticker, variant).catch(() => {});
  });
 }, [key, sticker, target, variant]);

 return variant === 'original' ? sticker.image || image : image;
}
