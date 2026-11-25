const maxDiskChars = 16 * 1024 * 1024;
const maxDiskEntries = 2048;

type DiskEntry = {key: string; size: number};
let opening: Promise<IDBDatabase | undefined> | undefined;

function openDatabase() {
 if (!opening) {
  opening = new Promise<IDBDatabase | undefined>(resolve => {
   if (typeof indexedDB === 'undefined') return resolve(undefined);
   try {
    const request = indexedDB.open('sombra-sticker-thumbnails', 1);
    let blocked = false;
    request.onblocked = () => {
     blocked = true;
     opening = undefined;
     resolve(undefined);
    };
    request.onupgradeneeded = () => {
     request.result.createObjectStore('thumbnails');
     request.result.createObjectStore('usage');
    };
    request.onsuccess = () => {
     const database = request.result;
     if (blocked) return database.close();
     database.onversionchange = () => {
      database.close();
      opening = undefined;
     };
     resolve(database);
    };
    request.onerror = () => resolve(undefined);
   } catch {
    resolve(undefined);
   }
  });
 }
 return opening;
}

export async function readStickerThumbnail(key: string): Promise<string | undefined> {
 const database = await openDatabase();
 return new Promise(resolve => {
  try {
   const request = database?.transaction('thumbnails').objectStore('thumbnails').get(key);
   if (!request) return resolve(undefined);
   request.onerror = () => resolve(undefined);
   request.onsuccess = () => resolve(typeof request.result === 'string' ? request.result : undefined);
  } catch {
   resolve(undefined);
  }
 });
}

/** Update usage and files in the same transaction, including quota errors and multiple windows. */
async function updateDisk(update: (entries: DiskEntry[], files: IDBObjectStore) => DiskEntry[]) {
 const database = await openDatabase();
 return new Promise<void>(resolve => {
  try {
   const transaction = database?.transaction(['thumbnails', 'usage'], 'readwrite');
   if (!transaction) return resolve();
   transaction.oncomplete = transaction.onabort = transaction.onerror = () => resolve();
   const usage = transaction.objectStore('usage');
   const read = usage.get('entries');
   read.onsuccess = () => {
    const entries = (read.result ?? []) as DiskEntry[];
    usage.put(update(entries, transaction.objectStore('thumbnails')), 'entries');
   };
  } catch {
   resolve();
  }
 });
}

export function writeStickerThumbnail(key: string, image: string) {
 const size = image.length;
 if (size > maxDiskChars) return Promise.resolve();
 return updateDisk((entries, files) => {
  const next = [...entries.filter(entry => entry.key !== key), {key, size}];
  let total = next.reduce((sum, entry) => sum + entry.size, 0);
  let drop = 0;
  while (total > maxDiskChars || next.length - drop > maxDiskEntries) {
   const entry = next[drop++];
   files.delete(entry.key);
   total -= entry.size;
  }
  files.put(image, key);
  return next.slice(drop);
 });
}

export function deleteStickerThumbnails(keys: string[]) {
 if (keys.length === 0) return Promise.resolve();
 return updateDisk((entries, files) => {
  const removed = new Set(keys);
  keys.forEach(key => files.delete(key));
  return entries.filter(entry => !removed.has(entry.key));
 });
}
