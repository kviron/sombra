// Кэш картинок стикеров: запрос на стикер один, при смене аккаунта кэш сбрасывается.
import {createStore} from 'zustand/vanilla';
import {stickerService} from './services/sticker-service';

const maxCachedImages = 256;
const requests = new Map<string, Promise<string>>();
let generation = 0;

export const stickerImageStore = createStore<{images: Record<string, string>}>(() => ({images: {}}));

export function clearStickerImages() {
 generation++;
 requests.clear();
 stickerImageStore.setState({images: {}}, true);
}

window.addEventListener('authchange', clearStickerImages);

/** Загрузка картинки стикера: повторные вызовы делят один запрос, ошибка снимает его из кэша. */
export function requestStickerImage(id: string) {
 const cached = requests.get(id);
 if (cached) return cached;
 const request = generation;
 const loaded = stickerService
  .image<{image: string}>({sticker: id})
  .then(result => {
   if (request === generation) stickerImageStore.setState(state => ({images: {...state.images, [id]: result.image}}));
   return result.image;
  })
  .catch(error => {
   requests.delete(id);
   throw error;
  });
 if (requests.size >= maxCachedImages) requests.delete(requests.keys().next().value!);
 requests.set(id, loaded);
 return loaded;
}
