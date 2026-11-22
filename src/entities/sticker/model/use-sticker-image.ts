import {useEffect, type RefObject} from 'react';
import {useStore} from 'zustand';
import type {Sticker} from '@/shared/types';
import {requestStickerImage, stickerImageStore} from './sticker-image-cache';

type Options = {sticker: Sticker; target: RefObject<HTMLImageElement | null>};

/** Картинка стикера: сразу из данных или лениво, когда элемент появился в окне. */
export function useStickerImage({sticker, target}: Options) {
 const image = useStore(stickerImageStore, state => state.images[sticker.id]);

 useEffect(() => {
  if (sticker.image) return;
  const element = target.current;
  if (!element) return;
  const observer = new IntersectionObserver(entries => {
   if (!entries.some(entry => entry.isIntersecting)) return;
   observer.disconnect();
   void requestStickerImage(sticker.id).catch(() => {});
  });
  observer.observe(element);
  return () => observer.disconnect();
 }, [sticker.id, sticker.image, target]);

 return sticker.image || image;
}
