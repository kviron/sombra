// Разбор ZIP и подготовка стикеров к отправке: сеть и UI сюда не входят.
import {unzipSync} from 'fflate';
import {
 archiveSizeError,
 imageExtension,
 maxArchiveBytes,
 maxArchiveEntries,
 maxImageSize,
 pathBaseName,
 stickerImageError,
 stickerKeywords,
 titleFor
} from './sticker-library-rules';

export type StickerFile = {name: string; file: Blob; keywords?: string[]};
type ManifestItem = {
 name?: string;
 file?: string;
 filename?: string;
 files?: {webp?: string; png?: string};
 keywords?: unknown;
};

/** Файлы пользователя превращаются в стикеры: одиночные картинки или содержимое ZIP с манифестом. */
export async function stickerFiles(files: File[]): Promise<{items: StickerFile[]; title?: string}> {
 if (files.length !== 1 || !/\.zip$/i.test(files[0].name))
  return {items: files.map(file => ({name: titleFor(file.name), file}))};
 const archive = files[0];
 const archiveError = archiveSizeError(archive.size);
 if (archiveError) throw new Error(archiveError);
 let count = 0,
  total = 0;
 const unpacked = unzipSync(new Uint8Array(await archive.arrayBuffer()), {
  filter: entry => {
   if (
    !imageExtension.test(entry.name) &&
    pathBaseName(entry.name) !== 'manifest.json' &&
    pathBaseName(entry.name) !== 'pack.json'
   )
    return false;
   total += entry.originalSize;
   if (++count > maxArchiveEntries || entry.originalSize > maxImageSize || total > maxArchiveBytes)
    throw new Error('В архиве слишком много данных.');
   return true;
  }
 });
 const manifestPath = Object.keys(unpacked).find(path => ['manifest.json', 'pack.json'].includes(pathBaseName(path)));
 if (manifestPath) {
  const manifest = JSON.parse(new TextDecoder().decode(unpacked[manifestPath]));
  const items: ManifestItem[] | undefined = Array.isArray(manifest) ? manifest : manifest?.stickers;
  if (Array.isArray(items)) {
   const directory = manifestPath.slice(0, manifestPath.lastIndexOf('/') + 1);
   const selected = items.flatMap(entry => {
    const file = entry?.files?.webp ?? entry?.files?.png ?? entry?.file ?? entry?.filename;
    if (typeof file !== 'string') return [];
    const path = [directory + file, directory + 'png/' + file, file].find(
     path => unpacked[path] && imageExtension.test(path)
    );
    if (!path) return [];
    return [
     {
      name: typeof entry.name === 'string' && entry.name.trim() ? entry.name : titleFor(path),
      file: asStickerBlob(path, unpacked[path]),
      keywords: stickerKeywords(entry.keywords)
     }
    ];
   });
   if (selected.length)
    return {items: selected, title: typeof manifest.name === 'string' ? manifest.name.trim() : undefined};
  }
 }
 const items = Object.entries(unpacked)
  .filter(([path]) => imageExtension.test(path) && !path.startsWith('__MACOSX/'))
  .sort(([a], [b]) => a.localeCompare(b, undefined, {numeric: true}))
  .map(([path, bytes]) => ({name: titleFor(path), file: asStickerBlob(path, bytes)}));
 return {items};
}

function asStickerBlob(path: string, bytes: Uint8Array) {
 return new Blob([Uint8Array.from(bytes)], {type: /\.webp$/i.test(path) ? 'image/webp' : 'image/png'});
}

/** Стикер приводится к 512 px WebP; готовый WebP 512 px отправляется без перекодирования. */
export async function encodeSticker(file: Blob) {
 const fileError = stickerImageError(file);
 if (fileError) throw new Error(fileError);
 const bitmap = await createImageBitmap(file);
 try {
  if (file.type === 'image/webp' && file.size <= 256 * 1024 && Math.max(bitmap.width, bitmap.height) === 512) {
   return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Не удалось прочитать стикер.'));
    reader.readAsDataURL(file);
   });
  }
  const scale = 512 / Math.max(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Не удалось обработать стикер.');
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/webp', 0.86);
 } finally {
  bitmap.close();
 }
}
