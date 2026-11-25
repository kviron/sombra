import {createStore} from 'zustand/vanilla';
import type {Sticker} from '@/shared/types';
import {stickerService} from './services/sticker-service';
import {stickerLibraryIds, type StickerCacheSnapshot} from './sticker-cache-access';
import {deleteStickerThumbnails, readStickerThumbnail, writeStickerThumbnail} from './sticker-thumbnail-disk';

export type StickerImageVariant = 'original' | 'thumbnail';
export const stickerImageKey = (id: string, variant: StickerImageVariant) => `${variant}:${id}`;
const diskKey = (owner: string, id: string) => JSON.stringify([owner, id]);
const isThumbnail = (image: string | undefined): image is string =>
 image?.startsWith('data:image/webp;base64,') ?? false;

const maxMemoryChars = 12 * 1024 * 1024;
const maxMemoryEntries = 256;
const maxConcurrentRequests = 4;
const maxWaitingRequests = 256;
const snapshotMaxAgeMs = 5000;
const requests = new Map<string, Promise<string>>();
const memoryEntries = new Map<string, number>();
const waiting: Array<() => void> = [];
let memoryChars = 0;
let activeRequests = 0;
let account = '';
let generation = 0;
let acceptedAt = 0;
let thumbnailsSupported = false;
let libraryIds = new Set<string>();

export const stickerImageStore = createStore<{images: Record<string, string>}>(() => ({images: {}}));

export function clearStickerImages() {
 generation++;
 account = '';
 acceptedAt = 0;
 thumbnailsSupported = false;
 libraryIds.clear();
 requests.clear();
 memoryEntries.clear();
 memoryChars = 0;
 stickerImageStore.setState({images: {}}, true);
}

if (typeof window !== 'undefined') window.addEventListener('authchange', clearStickerImages);

export function acceptStickerImageSnapshot(state: StickerCacheSnapshot) {
 if (account !== state.me.id) clearStickerImages();
 account = state.me.id;
 acceptedAt = Date.now();
 thumbnailsSupported = state.features?.stickerThumbnails === true;
 const nextIds = stickerLibraryIds(state);
 const revoked = [...libraryIds].filter(id => !nextIds.has(id));
 libraryIds = nextIds;
 if (!revoked.length) return;
 const images = {...stickerImageStore.getState().images};
 for (const id of revoked)
  for (const variant of ['thumbnail', 'original'] as const) {
   const key = stickerImageKey(id, variant);
   requests.delete(key);
   memoryChars -= memoryEntries.get(key) ?? 0;
   memoryEntries.delete(key);
   delete images[key];
  }
 stickerImageStore.setState({images});
 void deleteStickerThumbnails(revoked.map(id => diskKey(state.me.id, id)));
}

function remember(key: string, image: string) {
 if (image.length > maxMemoryChars) return;
 const images = {...stickerImageStore.getState().images, [key]: image};
 memoryChars += image.length - (memoryEntries.get(key) ?? 0);
 memoryEntries.delete(key);
 memoryEntries.set(key, image.length);
 while (memoryEntries.size > maxMemoryEntries || memoryChars > maxMemoryChars) {
  const oldest = memoryEntries.keys().next().value!;
  memoryChars -= memoryEntries.get(oldest)!;
  memoryEntries.delete(oldest);
  delete images[oldest];
 }
 stickerImageStore.setState({images});
}

function fetchWhenAvailable<T>(fetch: () => Promise<T>) {
 return new Promise<T>((resolve, reject) => {
  const start = () => {
   activeRequests++;
   void Promise.resolve()
    .then(fetch)
    .then(resolve, reject)
    .finally(() => {
     activeRequests--;
     waiting.shift()?.();
    });
  };
  if (activeRequests < maxConcurrentRequests) start();
  else if (waiting.length < maxWaitingRequests) waiting.push(start);
  else reject(new Error('Очередь загрузки стикеров заполнена'));
 });
}

export function requestStickerImage(sticker: Sticker, variant: StickerImageVariant) {
 const key = stickerImageKey(sticker.id, variant);
 const cached = stickerImageStore.getState().images[key];
 if (cached) {
  memoryEntries.delete(key);
  memoryEntries.set(key, cached.length);
  return Promise.resolve(cached);
 }
 const pending = requests.get(key);
 if (pending) return pending;
 const scope = generation;
 const owner = account;
 const useThumbnail = variant === 'thumbnail' && thumbnailsSupported;
 const canUseDisk = () =>
  useThumbnail &&
  !!owner &&
  account === owner &&
  libraryIds.has(sticker.id) &&
  Date.now() - acceptedAt < snapshotMaxAgeMs;
 const assertCurrent = () => {
  if (generation !== scope || requests.get(key) !== request) throw new Error('Доступ к стикеру изменился');
 };
 const request = Promise.resolve()
  .then(async () => {
   assertCurrent();
   const storageKey = diskKey(owner, sticker.id);
   const stored = canUseDisk() ? await readStickerThumbnail(storageKey) : undefined;
   assertCurrent();
   if (isThumbnail(stored) && canUseDisk()) {
    remember(key, stored);
    return stored;
   }
   const load = async () => {
    if (useThumbnail) {
     for (let attempt = 0; ; attempt++) {
      try {
       const asset = await fetchWhenAvailable(() => {
        assertCurrent();
        return stickerService.thumbnail({sticker: sticker.id});
       });
       return {...asset, thumbnail: true};
      } catch (error) {
       if (!(error instanceof Error)) throw error;
       if (error.message === 'STICKER_THUMBNAIL_UNAVAILABLE') break;
       if (error.message !== 'STICKER_THUMBNAIL_BUSY' || attempt >= 2) throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 200 * (attempt + 1) + Math.random() * 100));
      assertCurrent();
     }
    }
    const asset = sticker.image
     ? {image: sticker.image}
     : await fetchWhenAvailable(() => {
        assertCurrent();
        return stickerService.image({sticker: sticker.id});
       });
    return {...asset, thumbnail: false};
   };
   const {image, thumbnail} = await load();
   assertCurrent();
   remember(key, image);
   if (thumbnail && isThumbnail(image) && canUseDisk()) void writeStickerThumbnail(storageKey, image);
   return image;
  })
  .finally(() => {
   if (requests.get(key) === request) requests.delete(key);
  });
 requests.set(key, request);
 return request;
}
