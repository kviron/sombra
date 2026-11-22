// Conversation-local decoded previews; never retains RPC/base64 payloads.
export type PreviewOwner = {
 active: boolean;
 priority: number;
 notify: (url: string | undefined, error?: unknown) => void;
};
type Entry = {
 key: string;
 owners: Set<PreviewOwner>;
 load: () => Promise<unknown>;
 decode: (file: unknown) => Blob;
 valid: () => boolean;
 url?: string;
 bytes: number;
 used: number;
 idle: number;
 running: boolean;
 queued: boolean;
};
export class AttachmentPreviewCache {
 private entries = new Map<string, Entry>();
 private active = 0;
 private timer: ReturnType<typeof setTimeout> | undefined;
 private options: {
  bytes?: number;
  entries?: number;
  grace?: number;
  concurrency?: number;
  now?: () => number;
  create?: (blob: Blob) => string;
  revoke?: (url: string) => void;
 };
 constructor(options: AttachmentPreviewCache['options'] = {}) {
  this.options = options;
 }
 private now() {
  return this.options.now?.() ?? Date.now();
 }
 private interested(e: Entry) {
  return [...e.owners].some(o => o.active);
 }
 private remove(e: Entry) {
  if (this.entries.get(e.key) !== e) return;
  this.entries.delete(e.key);
  if (e.url) (this.options.revoke ?? URL.revokeObjectURL)(e.url);
  for (const owner of e.owners) owner.notify(undefined);
 }
 clear() {
  if (this.timer) clearTimeout(this.timer);
  this.timer = undefined;
  for (const e of [...this.entries.values()]) this.remove(e);
 }
 sweep() {
  const idle = [...this.entries.values()].filter(e => !this.interested(e)).sort((a, b) => a.used - b.used);
  let bytes = [...this.entries.values()].reduce((sum, e) => sum + e.bytes, 0),
   count = this.entries.size;
  for (const e of idle)
   if (
    this.now() - e.idle >= (this.options.grace ?? 60000) ||
    bytes > (this.options.bytes ?? 64 * 1024 * 1024) ||
    count > (this.options.entries ?? 48)
   ) {
    bytes -= e.bytes;
    count--;
    this.remove(e);
   }
  if (this.timer) clearTimeout(this.timer);
  this.timer = undefined;
  const next = [...this.entries.values()].filter(e => !this.interested(e));
  if (next.length)
   this.timer = setTimeout(
    () => this.sweep(),
    Math.max(1, Math.min(...next.map(e => (this.options.grace ?? 60000) - (this.now() - e.idle))))
   );
 }
 acquire(
  key: string,
  owner: PreviewOwner,
  load: () => Promise<unknown>,
  decode: (file: unknown) => Blob,
  valid: () => boolean
 ) {
  let e = this.entries.get(key);
  if (!e) {
   e = {
    key,
    owners: new Set(),
    load,
    decode,
    valid,
    bytes: 0,
    used: this.now(),
    idle: this.now(),
    running: false,
    queued: false
   };
   this.entries.set(key, e);
  }
  let entry = e;
  entry.owners.add(owner);
  entry.used = this.now();
  if (entry.url) owner.notify(entry.url);
  const update = (active: boolean, priority = 0) => {
   owner.active = active;
   owner.priority = priority;
   const existing = this.entries.get(key);
   if (active && existing && existing !== entry) {
    entry.owners.delete(owner);
    entry = existing;
    entry.owners.add(owner);
    if (entry.url) owner.notify(entry.url);
   }
   if (active && !this.entries.has(key)) {
    entry.url = undefined;
    entry.bytes = 0;
    entry.queued = false;
    this.entries.set(key, entry);
   }
   entry.used = this.now();
   if (!this.interested(entry)) entry.idle = this.now();
   if (active && !entry.url && !entry.running) entry.queued = true;
   this.sweep();
   this.pump();
  };
  update(owner.active, owner.priority);
  return {
   update,
   release: () => {
    entry.owners.delete(owner);
    if (!this.interested(entry)) entry.idle = this.now();
    if (!entry.owners.size && !entry.running) {
     /* Removed messages must not retain decoded bytes. */ this.remove(entry);
    }
    this.sweep();
    this.pump();
   }
  };
 }
 private pump() {
  while (this.active < (this.options.concurrency ?? 3)) {
   const e = [...this.entries.values()]
    .filter(e => e.queued && !e.running && this.interested(e) && e.valid())
    .sort(
     (a, b) =>
      Math.max(...[...b.owners].filter(o => o.active).map(o => o.priority)) -
       Math.max(...[...a.owners].filter(o => o.active).map(o => o.priority)) || a.used - b.used
    )[0];
   if (!e) return;
   e.queued = false;
   e.running = true;
   this.active++;
   const current = () => this.entries.get(e.key) === e && e.valid() && this.interested(e);
   void (async () => {
    try {
     const file = await e.load();
     if (!current()) return;
     const blob = e.decode(file);
     if (!current()) return;
     e.url = (this.options.create ?? URL.createObjectURL)(blob);
     e.bytes = blob.size;
     e.used = this.now();
     for (const o of e.owners) o.notify(e.url);
    } catch (error) {
     if (current()) for (const o of e.owners) if (o.active) o.notify(undefined, error);
    } finally {
     e.running = false;
     this.active--;
     if (!e.owners.size) this.remove(e);
     this.sweep();
     this.pump();
    }
   })();
  }
 }
}
