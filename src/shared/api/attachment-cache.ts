import {getMessageAttachments} from '../lib/message-attachments.ts';

export type CacheInfo = {enabled: boolean; limitMiB: number; bytes: number; files: number};
export class CacheUnavailable extends Error {
 constructor() {
  super('Локальное хранилище браузера недоступно.');
  this.name = 'CacheUnavailable';
 }
}
type Metadata = {id: string; name: string; mime: string; size: number; cached?: boolean};
type FilePayload = {data: string; name: string; mime: string; cached?: boolean};
type Snapshot = {me: {id: string}; messages: Array<{id: string; attachment?: Metadata; attachments?: Metadata[]}>};
type Entry = {
 key: string;
 account: string;
 message: string;
 attachment: string;
 name: string;
 mime: string;
 size: number;
 checksum: number;
 used: number;
};
const MiB = 1024 * 1024,
 limits = [0, 256, 512, 1024, 2048, 4096];
let writeEpoch = 0;
export function attachmentCacheWriteEpoch() {
 return writeEpoch;
}
/** Invalidates decoded previews as well as late reads after a successful cache change. */
export function notifyAttachmentCacheChange() {
 writeEpoch++;
 if (typeof window !== 'undefined') window.dispatchEvent(new Event('attachmentcachechange'));
}
let generation = 0,
 account = '',
 accepted = 0,
 visible = new Map<string, Metadata[]>(),
 dbPromise: Promise<IDBDatabase> | undefined;
let queue: Promise<unknown> = Promise.resolve();
const serial = <T>(run: () => Promise<T>): Promise<T> => {
 const next = queue.then(run, run);
 queue = next.catch(() => {});
 return next;
};
function database(): Promise<IDBDatabase> {
 if (!dbPromise)
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
   if (typeof indexedDB === 'undefined') {
    reject(new CacheUnavailable());
    return;
   }
   const request = indexedDB.open('sombra-attachment-cache', 2);
   request.onupgradeneeded = () => {
    const db = request.result;
    if (db.objectStoreNames.contains('files')) db.deleteObjectStore('files');
    db.createObjectStore('files', {keyPath: 'key'});
    if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
    db.createObjectStore('payloads');
   };
   request.onsuccess = () => resolve(request.result);
   request.onerror = () => reject(new CacheUnavailable());
   request.onblocked = () => reject(new CacheUnavailable());
  }).catch(error => {
   dbPromise = undefined;
   throw error;
  });
 return dbPromise!;
}
async function transaction<T>(
 mode: IDBTransactionMode,
 run: (files: IDBObjectStore, settings: IDBObjectStore, done: (value: T) => void, payloads: IDBObjectStore) => void
): Promise<T> {
 try {
  const db = await database();
  return await new Promise<T>((resolve, reject) => {
   const tx = db.transaction(['files', 'settings', 'payloads'], mode);
   let value: T;
   tx.oncomplete = () => resolve(value);
   tx.onerror = tx.onabort = () => reject(new CacheUnavailable());
   run(
    tx.objectStore('files'),
    tx.objectStore('settings'),
    result => {
     value = result;
    },
    tx.objectStore('payloads')
   );
  });
 } catch {
  throw new CacheUnavailable();
 }
}
function checksum(data: string) {
 let hash = 2166136261;
 for (let i = 0; i < data.length; i++) hash = Math.imul(hash ^ data.charCodeAt(i), 16777619);
 return hash >>> 0;
}
function key(owner: string, message: string, id: string) {
 return JSON.stringify([owner, message, id]);
}
export function resetAttachmentCacheAccess() {
 generation++;
 account = '';
 accepted = 0;
 visible = new Map();
}
export function attachmentCacheGeneration() {
 return generation;
}
function valid(file: FilePayload, meta: Metadata) {
 if (
  !file ||
  typeof file.data !== 'string' ||
  file.data.length > Math.ceil((10 * MiB) / 3) * 4 ||
  file.name !== meta.name ||
  file.mime !== meta.mime ||
  !Number.isSafeInteger(meta.size) ||
  meta.size < 0 ||
  meta.size > 10 * MiB
 )
  return false;
 try {
  return file.data.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(file.data) && atob(file.data).length === meta.size;
 } catch {
  return false;
 }
}
export async function acceptAttachmentCacheState<T extends Snapshot>(state: T, epoch: number): Promise<T> {
 if (epoch !== generation) throw new Error('Сессия изменилась. Обновите историю.');
 if (!state?.me?.id || !Array.isArray(state.messages)) {
  resetAttachmentCacheAccess();
  return state;
 }
 const nextVisible = new Map<string, Metadata[]>();
 for (const message of state.messages) {
  const files = getMessageAttachments(message);
  if (files.length)
   nextVisible.set(
    message.id,
    files.map(file => ({...file}))
   );
 }
 if (
  account &&
  (account !== state.me.id ||
   [...visible].some(([id, files]) =>
    files.some((file, i) => {
     const next = nextVisible.get(id)?.[i];
     return (
      !next || next.id !== file.id || next.name !== file.name || next.mime !== file.mime || next.size !== file.size
     );
    })
   ))
 )
  generation++;
 account = state.me.id;
 accepted = Date.now();
 visible = nextVisible;
 const owner = account,
  scope = generation;
 const decorate = (cached?: Set<string>) => {
  for (const message of state.messages) {
   const mark = (file: Metadata) => {
    file.cached = cached?.has(key(owner, message.id, file.id)) ?? false;
   };
   message.attachments?.forEach(mark);
   if (message.attachment) mark(message.attachment);
  }
 };
 decorate();
 try {
  const cached = await serial(() =>
   transaction<Set<string>>('readwrite', (files, _settings, done, payloads) => {
    const found = new Set<string>();
    const request = files.openCursor();
    request.onsuccess = () => {
     const cursor = request.result;
     if (!cursor) {
      done(found);
      return;
     }
     const entry = cursor.value as Entry;
     if (entry.account === owner) {
      const meta = nextVisible.get(entry.message)?.find(file => file.id === entry.attachment);
      if (!meta || entry.name !== meta.name || entry.mime !== meta.mime || entry.size !== meta.size) {
       cursor.delete();
       payloads.delete(entry.key);
      } else found.add(entry.key);
     }
     cursor.continue();
    };
   })
  );
  if (scope === generation) decorate(cached);
 } catch {
  /* Online history is independent of local storage. */
 }
 if (scope !== generation) throw new Error('Сессия или доступ к вложениям изменились.');
 return state;
}
export function attachmentCacheNeedsState() {
 return !account || Date.now() - accepted > 5000;
}
function visibleAttachment(message: string, id?: string) {
 const files = visible.get(message);
 return id === undefined ? files?.[0] : files?.find(file => file.id === id);
}
export async function readAttachmentCache(message: string, attachmentId?: string): Promise<FilePayload | undefined> {
 const scope = generation,
  owner = account,
  meta = visibleAttachment(message, attachmentId);
 if (!meta || attachmentCacheNeedsState()) return;
 try {
  return await serial(() =>
   transaction<FilePayload | undefined>('readwrite', (files, settings, done, payloads) => {
    const setting = settings.get(key(owner, 'settings', 'limitMiB'));
    setting.onsuccess = () => {
     if (setting.result === 0 || scope !== generation) {
      done(undefined);
      return;
     }
     const request = files.get(key(owner, message, meta.id));
     request.onsuccess = () => {
      const entry = request.result as Entry | undefined;
      if (
       !entry ||
       scope !== generation ||
       visibleAttachment(message, attachmentId)?.id !== meta.id ||
       attachmentCacheNeedsState()
      ) {
       done(undefined);
       return;
      }
      const payload = payloads.get(entry.key);
      payload.onsuccess = () => {
       const file = {data: payload.result, name: entry.name, mime: entry.mime};
       if (
        scope !== generation ||
        visibleAttachment(message, attachmentId)?.id !== meta.id ||
        attachmentCacheNeedsState()
       ) {
        done(undefined);
        return;
       }
       if (!valid(file, meta) || checksum(file.data) !== entry.checksum) {
        files.delete(entry.key);
        payloads.delete(entry.key);
        done(undefined);
        return;
       }
       entry.used = Date.now();
       files.put(entry);
       done({...file, cached: true});
      };
     };
    };
   })
  );
 } catch {
  return;
 }
}
export async function writeAttachmentCache(
 message: string,
 file: FilePayload,
 scope: number,
 epoch = writeEpoch,
 attachmentId?: string
): Promise<void> {
 const owner = account,
  meta = visibleAttachment(message, attachmentId);
 if (epoch !== writeEpoch || scope !== generation || !owner || !meta || !valid(file, meta)) return;
 try {
  await serial(() =>
   transaction<void>('readwrite', (files, settings, done, payloads) => {
    const setting = settings.get(key(owner, 'settings', 'limitMiB'));
    setting.onsuccess = () => {
     const limit = setting.result ?? 1024;
     if (
      epoch !== writeEpoch ||
      scope !== generation ||
      visibleAttachment(message, attachmentId)?.id !== meta.id ||
      !limit
     ) {
      done();
      return;
     }
     const entry: Entry = {
      key: key(owner, message, meta.id),
      account: owner,
      message,
      attachment: meta.id,
      name: meta.name,
      mime: meta.mime,
      size: meta.size,
      checksum: checksum(file.data),
      used: Date.now()
     };
     files.put(entry);
     payloads.put(file.data, entry.key);
     const request = files.getAll();
     request.onsuccess = () => {
      let bytes = 0;
      const entries = (request.result as Entry[]).filter(item => item.account === owner);
      for (const item of entries) bytes += item.size;
      for (const item of entries.sort((a, b) => a.used - b.used)) {
       if (bytes <= limit * MiB) break;
       files.delete(item.key);
       payloads.delete(item.key);
       bytes -= item.size;
      }
      done();
     };
    };
   })
  );
 } catch {
  /* Quota and disabled storage must never break downloads. */
 }
}
function requireScope(owner: string, scope: number) {
 if (!owner || owner !== account || scope !== generation)
  throw new Error('Сессия изменилась. Обновите настройки хранилища.');
}
async function cacheInfo(owner: string, scope: number): Promise<CacheInfo> {
 requireScope(owner, scope);
 const info = await serial(() =>
  transaction<CacheInfo>('readonly', (files, settings, done) => {
   requireScope(owner, scope);
   const limit = settings.get(key(owner, 'settings', 'limitMiB'));
   limit.onsuccess = () => {
    const request = files.getAll();
    request.onsuccess = () => {
     const entries = (request.result as Entry[]).filter(item => item.account === owner);
     done({
      enabled: (limit.result ?? 1024) > 0,
      limitMiB: limit.result ?? 1024,
      bytes: entries.reduce((sum, item) => sum + item.size, 0),
      files: entries.length
     });
    };
   };
  })
 );
 requireScope(owner, scope);
 return info;
}
export async function getBrowserAttachmentCacheInfo(): Promise<CacheInfo> {
 return cacheInfo(account, generation);
}
export async function setBrowserAttachmentCacheLimit(limitMiB: number): Promise<CacheInfo> {
 if (!limits.includes(limitMiB)) throw new Error('Недопустимый размер локального кэша.');
 const owner = account,
  scope = generation;
 requireScope(owner, scope);
 writeEpoch++;
 await serial(() =>
  transaction<void>('readwrite', (files, settings, done, payloads) => {
   requireScope(owner, scope);
   const request = files.getAll();
   request.onsuccess = () => {
    if (owner !== account || scope !== generation) {
     done();
     return;
    }
    settings.put(limitMiB, key(owner, 'settings', 'limitMiB'));
    const entries = (request.result as Entry[]).filter(item => item.account === owner);
    let bytes = entries.reduce((sum, item) => sum + item.size, 0);
    for (const entry of entries.sort((a, b) => a.used - b.used)) {
     if (limitMiB && bytes <= limitMiB * MiB) break;
     files.delete(entry.key);
     payloads.delete(entry.key);
     bytes -= entry.size;
    }
    done();
   };
  })
 );
 return cacheInfo(owner, scope);
}
export async function clearBrowserAttachmentCache(): Promise<CacheInfo> {
 const owner = account,
  scope = generation;
 requireScope(owner, scope);
 writeEpoch++;
 await serial(() =>
  transaction<void>('readwrite', (files, _settings, done, payloads) => {
   requireScope(owner, scope);
   const request = files.getAll();
   request.onsuccess = () => {
    if (owner === account && scope === generation)
     for (const entry of request.result as Entry[])
      if (entry.account === owner) {
       files.delete(entry.key);
       payloads.delete(entry.key);
      }
    done();
   };
  })
 );
 return cacheInfo(owner, scope);
}
