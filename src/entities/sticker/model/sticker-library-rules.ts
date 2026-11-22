// Чистые правила библиотеки стикеров: без сети и DOM, поэтому проверяются тестами.
import type {Sticker} from '@/shared/types';

/** Пределы импорта и названий — правила сервера, а не настройка интерфейса. */
export const imageExtension = /\.(png|webp)$/i;
export const maxImageSize = 8 * 1024 * 1024;
export const maxArchiveSize = 80 * 1024 * 1024;
export const maxArchiveEntries = 410;
export const maxArchiveBytes = 100 * 1024 * 1024;
export const maxPackNameLength = 60;
export const maxStickerNameLength = 40;
export const maxKeywordLength = 48;
export const maxKeywords = 24;
export const maxImportItems = 200;
export const uploadBatchItems = 48;
export const uploadBatchBytes = 650_000;
export const fallbackStickerName = 'Стикер';
export const personalPackFallback = 'Мои стикеры';

/** Имя файла без каталогов: ZIP приходит с путями в любом формате. */
export function pathBaseName(path: string) {
 return path.split(/[\\/]/).pop() || path;
}

/** Название стикера по имени файла: без расширения и с запасным значением. */
export function titleFor(path: string) {
 return (
  pathBaseName(path)
   .replace(/\.[^.]+$/, '')
   .trim() || fallbackStickerName
 );
}

/** Личный стикер: свой или из установленного набора; групповые живут отдельно. */
export const personalSticker = (sticker: Sticker, user: string) =>
 !sticker.group && (sticker.owner === user || sticker.packInstalled === true);

export const stickerPackKey = (sticker: Sticker) => sticker.packId || sticker.pack || '';

/** Что видно в библиотеке: без архивных; для группы — только её стикеры. */
export function libraryStickers(stickers: Sticker[], user: string, group?: string) {
 return stickers.filter(
  sticker => !sticker.archived && (group ? sticker.group === group : personalSticker(sticker, user))
 );
}

/** Наборы идут в порядке первого стикера; внутри набора порядок исходный. */
export function groupStickersByPack(stickers: Sticker[]) {
 const packs = new Map<string, Sticker[]>();
 for (const sticker of stickers) {
  const key = stickerPackKey(sticker);
  const items = packs.get(key);
  if (items) items.push(sticker);
  else packs.set(key, [sticker]);
 }
 return [...packs];
}

/** Название набора: черновик, имя из манифеста, имя файла или запасное. */
export function packName(draft: string, manifestTitle: string | undefined, files: {name: string}[]) {
 const suggested =
  draft.trim() || manifestTitle || (files.length === 1 ? titleFor(files[0].name) : personalPackFallback);
 return [...suggested].slice(0, maxPackNameLength).join('');
}

/** Имя стикера обрезается по символам, пустое заменяется запасным. */
export const stickerName = (name: string) =>
 [...name.trim()].slice(0, maxStickerNameLength).join('') || fallbackStickerName;

/** Ключевые слова из манифеста: строки без повторов, обрезанные по символам. */
export function stickerKeywords(values: unknown) {
 if (!Array.isArray(values)) return undefined;
 const cleaned = values
  .filter((value): value is string => typeof value === 'string')
  .map(value => [...value.trim()].slice(0, maxKeywordLength).join(''))
  .filter(Boolean);
 return [...new Set(cleaned)].slice(0, maxKeywords);
}

/** Ошибка выбранного изображения: формат и размер проверяются до отправки. */
export function stickerImageError(file: {type: string; size: number}) {
 return ['image/png', 'image/webp'].includes(file.type) && file.size <= maxImageSize
  ? ''
  : 'Выберите PNG или WebP до 8 МБ.';
}

export function importCountError(count: number) {
 return count < 1 || count > maxImportItems ? 'Добавьте от 1 до 200 изображений PNG или WebP.' : '';
}

export function archiveSizeError(size: number) {
 return size > maxArchiveSize ? 'ZIP должен быть не больше 80 МБ.' : '';
}

/** Нарезка импорта на пачки: сервер принимает не больше 48 стикеров и ~650 КБ за запрос. */
export function stickerBatches<T>(items: T[]) {
 const encoder = new TextEncoder();
 const batches: T[][] = [];
 let batch: T[] = [],
  bytes = 0;
 for (const item of items) {
  const size = encoder.encode(JSON.stringify(item)).length + 1;
  if (batch.length === uploadBatchItems || bytes + size > uploadBatchBytes) {
   if (batch.length) batches.push(batch);
   batch = [];
   bytes = 0;
  }
  batch.push(item);
  bytes += size;
 }
 if (batch.length) batches.push(batch);
 return batches;
}

/** Подпись плитки общего каталога: свой набор или уже добавленный. */
export function catalogPackNote(pack: {count: number; owner: string; installed: boolean}, user: string) {
 const mark = pack.owner === user ? ' · Ваш набор' : pack.installed ? ' · Добавлен' : '';
 return `${pack.count} шт.${mark}`;
}

/** Подпись набора в личной библиотеке: добавленный или опубликованный. */
export function libraryPackNote(count: number, source: Sticker, added: boolean) {
 const mark = added ? ' · Добавлен' : source.packPublic ? ' · Опубликован' : '';
 return `${count} шт.${mark}`;
}

/** Отправленный стикер открывает набор только в каталоге и только если набор публичный и не свой. */
export function shouldPreviewSentSticker(sticker: Sticker, user: string, catalog?: boolean) {
 return (
  !!catalog &&
  !!sticker.packId &&
  !!sticker.packPublic &&
  !sticker.packAdded &&
  !personalSticker(sticker, user) &&
  !sticker.group
 );
}
