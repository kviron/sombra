import {tauri} from './tauri';
import {createAvatarCache} from './avatars';
import {
 notifyAttachmentCacheChange,
 attachmentCacheWriteEpoch,
 acceptAttachmentCacheState,
 attachmentCacheGeneration,
 attachmentCacheNeedsState,
 readAttachmentCache,
 writeAttachmentCache,
 resetAttachmentCacheAccess,
 getBrowserAttachmentCacheInfo,
 setBrowserAttachmentCacheLimit,
 clearBrowserAttachmentCache,
 type CacheInfo
} from './attachment-cache';
export type {CacheInfo} from './attachment-cache';
export {CacheUnavailable} from './attachment-cache';
export const getAttachmentCacheInfo = (): Promise<CacheInfo> =>
 tauri.isTauri() ? tauri.commands.cache.info<CacheInfo>() : getBrowserAttachmentCacheInfo();
export async function setAttachmentCacheLimit(limitMiB: number): Promise<CacheInfo> {
 const result = await (tauri.isTauri()
  ? tauri.commands.cache.setLimit<CacheInfo>(limitMiB)
  : setBrowserAttachmentCacheLimit(limitMiB));
 attachmentRequests.clear();
 notifyAttachmentCacheChange();
 return result;
}
export async function clearAttachmentCache(): Promise<CacheInfo> {
 const result = await (tauri.isTauri() ? tauri.commands.cache.clear<CacheInfo>() : clearBrowserAttachmentCache());
 attachmentRequests.clear();
 notifyAttachmentCacheChange();
 return result;
}
let stateRequest = 0,
 acceptedStateRequest = 0,
 rawStateRequest = 0,
 acceptedRawStateRequest = 0;
const attachmentRequests = new Map<string, Promise<unknown>>();
// Several places read the same snapshot at nearly the same moment (a poll tick and a
// notification activation, say). One request answers them all; mutating ops are never merged.
const readOperations = new Set([
 'state',
 'music_state',
 'music_file',
 'sessions',
 'get_bot_settings',
 'bot_get_model_settings',
 'message_readers',
 'list_public_sticker_packs',
 'search_conversation_members',
 'sticker_image'
]);
const readRequests = new Map<string, Promise<unknown>>();
/** Pictures are fetched once per version: see avatars.ts. */
const avatars = createAvatarCache(async ref =>
 request<{kind: string; id: string; sha: string; data: string}>('avatar_file', {
  kind: ref.kind,
  id: ref.id,
  sha: ref.sha
 })
);
export const session = () => localStorage.getItem('mines-session') || '';
export function clearSession() {
 resetAttachmentCacheAccess();
 attachmentRequests.clear();
 readRequests.clear();
 avatars.clear();
 localStorage.removeItem('mines-session');
 sessionStorage.removeItem('mines-jwt');
 window.dispatchEvent(new Event('authchange'));
 if (window.location.hash !== '#register') window.location.hash = '#login';
}
export class ApiConnectionError extends Error {}
export async function request<T = any>(op: string, data: Record<string, unknown> = {}): Promise<T> {
 // Ask polling snapshots for avatar hashes instead of inline pictures.
 const payload = op === 'state' ? {avatar_assets: true, ...data} : data;
 if (!readOperations.has(op)) return perform<T>(op, payload);
 const key = op + '\n' + JSON.stringify(payload);
 const shared = readRequests.get(key);
 if (shared) return shared as Promise<T>;
 const request = perform<T>(op, payload);
 readRequests.set(key, request);
 try {
  return await request;
 } finally {
  if (readRequests.get(key) === request) readRequests.delete(key);
 }
}
import type {AttachmentFile, ChatState, User} from '@/shared/types';
import {uniqueIds, uniqueRows} from './unique-rows';
export {uniqueRows} from './unique-rows';
function normalizeState(state: ChatState): ChatState {
 return {
  ...state,
  dialogs: uniqueRows(state.dialogs, 'переписках').map(dialog => ({...dialog, members: uniqueIds(dialog.members)})),
  users: uniqueRows(state.users, 'участниках'),
  groups: uniqueRows(state.groups, 'группах').map(group => ({
   ...group,
   members: uniqueIds(group.members),
   channels: uniqueRows(group.channels, 'каналах группы')
  })),
  messages: uniqueRows(state.messages, 'сообщениях'),
  friends: uniqueRows(state.friends, 'заявках в друзья'),
  dialogCalls: uniqueRows(state.dialogCalls, 'звонках')
 };
}

async function hydrateState<T>(state: T): Promise<T> {
 return normalizeState((await avatars.hydrate(state as unknown as ChatState)) as ChatState) as unknown as T;
}

async function perform<T>(op: string, payload: Record<string, unknown>): Promise<T> {
 if (tauri.isTauri()) {
  let result: T;
  try {
   result = await tauri.commands.remote<T>({op, token: session(), ...payload});
  } catch (error) {
   const message = String(error);
   if (message.includes('AUTH_REQUIRED')) clearSession();
   if (message.startsWith('REMOTE_UNAVAILABLE:')) throw new ApiConnectionError(message.slice(19));
   throw new Error(message, {cause: error});
  }
  return op === 'state' ? ((await hydrateState(result)) as T) : result;
 }
 if (op === 'login' || op === 'register' || op === 'logout') {
  resetAttachmentCacheAccess();
  attachmentRequests.clear();
 }
 const scope = attachmentCacheGeneration();
 const stateSequence = op === 'state' ? ++stateRequest : 0;
 if (op === 'attachment_file') {
  const writeEpoch = attachmentCacheWriteEpoch();
  const key = JSON.stringify([scope, writeEpoch, payload]);
  const existing = attachmentRequests.get(key);
  if (existing) return existing as Promise<T>;
  const request = (async () => {
   if (attachmentCacheNeedsState())
    await browserRaw<ChatState>('state').then(state => acceptAttachmentCacheState(state, scope));
   if (scope !== attachmentCacheGeneration()) throw new Error('Сессия изменилась. Повторите загрузку.');
   const cached = await readAttachmentCache(String(payload.message));
   if (scope !== attachmentCacheGeneration()) throw new Error('Сессия изменилась.');
   if (cached) return cached as T;
   const file = await browserRaw<AttachmentFile>(op, payload);
   file.cached = false;
   if (scope !== attachmentCacheGeneration()) throw new Error('Сессия изменилась. Повторите загрузку.');
   await writeAttachmentCache(String(payload.message), file, scope, writeEpoch);
   if (scope !== attachmentCacheGeneration()) throw new Error('Сессия изменилась.');
   return file as T;
  })();
  attachmentRequests.set(key, request);
  try {
   return await request;
  } finally {
   if (attachmentRequests.get(key) === request) attachmentRequests.delete(key);
  }
 }
 const result = await browserRaw<T>(op, payload);
 if (op === 'state') {
  if (stateSequence < acceptedStateRequest) throw new Error('История уже обновлена.');
  acceptedStateRequest = stateSequence;
  const accepted = await acceptAttachmentCacheState(result as unknown as ChatState, scope);
  return (await hydrateState(accepted)) as T;
 }
 return result;
}
async function browserRaw<T>(op: string, data: Record<string, unknown> = {}): Promise<T> {
 const scope = attachmentCacheGeneration(),
  sequence = op === 'state' ? ++rawStateRequest : 0;
 let response: Response;
 try {
  response = await fetch('/api', {
   method: 'POST',
   headers: {'Content-Type': 'application/json'},
   body: JSON.stringify({op, token: session(), ...data}),
   signal: AbortSignal.timeout(
    op === 'voice_poll'
     ? 5000
     : op === 'attachment_file' || (op === 'message' && data.attachment)
       ? 90000
       : op === 'state'
         ? 30000
         : 15000
   )
  });
 } catch {
  throw new ApiConnectionError('Не удалось связаться с сервером. Проверьте соединение и попробуйте снова.');
 }
 if (op === 'voice_poll' && response.status >= 500) throw new ApiConnectionError('Сервер временно недоступен');
 let result;
 try {
  result = await response.json();
 } catch {
  throw new Error('Сервер входа недоступен. Попробуйте снова через несколько секунд.');
 }
 if (!result || typeof result !== 'object') throw new Error('Некорректный ответ сервера. Попробуйте снова.');
 if (response.status === 401) {
  if (scope === attachmentCacheGeneration()) clearSession();
  throw new Error('Сессия завершена. Войдите снова.');
 }
 if (result.error && String(result.error).includes('AUTH_REQUIRED') && scope === attachmentCacheGeneration())
  clearSession();
 else if (
  (response.status === 403 ||
   (op === 'attachment_file' && String(result.error || '').includes('Сообщение не найдено'))) &&
  scope === attachmentCacheGeneration()
 )
  resetAttachmentCacheAccess();
 if (!response.ok) throw new Error(result.error || 'Сервер недоступен');
 if (result.error) throw new Error(String(result.error));
 if (!('data' in result)) throw new Error('Некорректный ответ сервера. Попробуйте снова.');
 if (op === 'state') {
  if (sequence < acceptedRawStateRequest) throw new Error('История уже обновлена.');
  acceptedRawStateRequest = sequence;
 }
 return result.data as T;
}
export async function authenticate(op: 'login' | 'register', data: Record<string, unknown>) {
 const result = await request<{token?: string; user: User}>(op, {
  ...data,
  device: tauri.isTauri() ? 'Sombra · ' + navigator.platform : navigator.userAgent
 });
 if (!result?.user?.id) throw new Error('Сервер не подтвердил вход. Попробуйте снова.');
 avatars.clear();
 if (tauri.isTauri() && result.token) localStorage.setItem('mines-session', result.token);
 window.dispatchEvent(new Event('authchange'));
 window.location.hash = '#chat';
}
export async function logout() {
 await request('logout');
 clearSession();
}
