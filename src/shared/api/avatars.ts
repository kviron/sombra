/**
 * Avatars are fetched once per version and cached by content hash, so a poll that
 * runs every two seconds no longer carries every picture inline. The server sends
 * `avatar:""` plus `avatarHash` when the caller asks for `avatar_assets`; anything
 * else (older server, `me`, profile updates) keeps the inline data URL and is left
 * untouched. A hash is only a cache key, never a capability: `avatar_file` checks
 * the session and the current record server-side.
 */

export type AvatarKind = 'user' | 'group';
export type AvatarRef = {kind: AvatarKind; id: string; sha: string};
export type AvatarFile = {kind: string; id: string; sha: string; data: string};
export type AvatarLoader = (ref: AvatarRef) => Promise<AvatarFile | undefined>;

/** The server accepts an inline avatar up to 700 000 base64 characters. */
const MAX_DATA = 700_032;
const MAX_CACHE = 64;
/** The server sends a base64url SHA-256 without padding (43 characters). */
const HASH = /^[A-Za-z0-9_-]{43}$/;

type AvatarRow = {id?: unknown; avatar?: unknown; avatarHash?: unknown};
type AvatarState = {me?: AvatarRow; users?: AvatarRow[]; groups?: AvatarRow[]};

export function createAvatarCache(load: AvatarLoader) {
 const cache = new Map<string, string>();
 const failed = new Set<string>();
 const inflight = new Map<string, Promise<string | undefined>>();

 function usable(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('data:image/') && value.length <= MAX_DATA;
 }

 async function resolve(ref: AvatarRef): Promise<string | undefined> {
  const cached = cache.get(ref.sha);
  if (cached) return cached;
  const key = `${ref.kind}:${ref.id}:${ref.sha}`;
  // One failed fetch must not turn into a request per poll for the whole session.
  if (failed.has(key)) return undefined;
  const running = inflight.get(key);
  if (running) return running;
  const request = (async () => {
   const file = await load(ref).catch(() => undefined);
   if (!file || file.kind !== ref.kind || file.id !== ref.id || file.sha !== ref.sha || !usable(file.data)) {
    failed.add(key);
    return undefined;
   }
   if (cache.size >= MAX_CACHE) cache.clear();
   cache.set(ref.sha, file.data);
   return file.data;
  })();
  inflight.set(key, request);
  try {
   return await request;
  } finally {
   if (inflight.get(key) === request) inflight.delete(key);
  }
 }

 /** Returns the same object when there is nothing to fetch, a patched copy otherwise. */
 async function hydrate<T>(value: T): Promise<T> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const state = value as AvatarState;
  const refs: AvatarRef[] = [];
  const want = (kind: AvatarKind, row: AvatarRow | undefined) => {
   if (!row || typeof row.id !== 'string' || row.avatar) return;
   const sha = row.avatarHash;
   if (typeof sha !== 'string' || !HASH.test(sha)) return;
   if (!refs.some(ref => ref.kind === kind && ref.id === row.id && ref.sha === sha)) {
    refs.push({kind, id: row.id, sha});
   }
  };
  want('user', state.me);
  for (const row of state.users ?? []) want('user', row);
  for (const row of state.groups ?? []) want('group', row);
  if (!refs.length) return value;
  const found = new Map<string, string>();
  await Promise.all(
   refs.map(async ref => {
    const url = await resolve(ref);
    if (url) found.set(`${ref.kind}:${ref.id}`, url);
   })
  );
  if (!found.size) return value;
  const patch = <R extends {id: string; avatar?: string}>(kind: AvatarKind, row: R): R => {
   if (row.avatar) return row;
   const url = found.get(`${kind}:${row.id}`);
   return url ? {...row, avatar: url} : row;
  };
  const next: AvatarState = {...state};
  if (state.me) next.me = patch('user', state.me as {id: string; avatar?: string});
  if (state.users) next.users = state.users.map(row => patch('user', row as {id: string; avatar?: string}));
  if (state.groups) {
   next.groups = state.groups.map(row => patch('group', row as {id: string; avatar?: string}));
  }
  return next as unknown as T;
 }

 /** A different account must not inherit the previous session's failures. */
 function clear() {
  cache.clear();
  failed.clear();
  inflight.clear();
 }

 return {hydrate, clear};
}
