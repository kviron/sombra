import { invoke, isTauri } from '@tauri-apps/api/core';
export const session = () => localStorage.getItem('mines-session') || '';
export function clearSession() { localStorage.removeItem('mines-session'); sessionStorage.removeItem('mines-jwt'); window.dispatchEvent(new Event('authchange')); if(window.location.hash !== '#register') window.location.hash = '#login'; }
export class ApiConnectionError extends Error {}
export async function api<T = any>(op: string, data: Record<string, unknown> = {}): Promise<T> {
 if (!isTauri()) {
   let response: Response;
   try {
     response = await fetch('/api', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,token:session(),...data}), signal: AbortSignal.timeout(op==='voice_poll'?5000:op==='attachment_file'||(op==='message'&&data.attachment)?90000:15000)});
   } catch {
     throw new ApiConnectionError('Не удалось связаться с сервером. Проверьте соединение и попробуйте снова.');
   }
   if(op==='voice_poll'&&response.status>=500)throw new ApiConnectionError('Сервер временно недоступен');
   let result;
   try { result = await response.json(); }
   catch { throw new Error('Сервер входа недоступен. Попробуйте снова через несколько секунд.'); }
   if (!result || typeof result !== 'object') throw new Error('Некорректный ответ сервера. Попробуйте снова.');
   if (response.status === 401) { clearSession(); throw new Error('Сессия завершена. Войдите снова.'); }
   if (!response.ok) throw new Error(result.error || 'Сервер недоступен');
   if (result.error) throw new Error(String(result.error));
   if (!('data' in result)) throw new Error('Некорректный ответ сервера. Попробуйте снова.');
   return result.data as T;
 }
 try { return await invoke<T>('remote_api', {request: {op, token: session(), ...data}}); }
 catch (error) {
  const message=String(error);
  if(message.includes('AUTH_REQUIRED'))clearSession();
  const connectionError='REMOTE_UNAVAILABLE:';
  if(message.startsWith(connectionError))throw new ApiConnectionError(message.slice(connectionError.length));
  throw new Error(message);
 }
}
export async function authenticate(op: 'login' | 'register', data: Record<string, unknown>) {
 const result = await api<{token?: string; user: User}>(op, {...data, device: isTauri() ? 'Sombra · '+navigator.platform : navigator.userAgent});
 if (!result?.user?.id) throw new Error('Сервер не подтвердил вход. Попробуйте снова.');
 if (isTauri() && result.token) localStorage.setItem('mines-session', result.token);
 window.dispatchEvent(new Event('authchange'));
 window.location.hash = '#chat';
}
export async function logout() {
 await api('logout'); clearSession();
}
export type SessionDto = {id:string;device:string;created_at:number;last_seen:number;expires_at:number;current:boolean};
export type ProfileDto = {name:string;bio:string};
export type BotCommand = {command:string;description:string};
export type User = {id:string;name:string;bio:string;avatar?:string;created_at:number;online?:boolean;last_seen?:number;bot?:boolean;username?:string;commands?:BotCommand[]};
export type Channel = {id:string;name:string;kind:string};
export type Group = {id:string;name:string;owner:string;invite:string;members:string[];channels:Channel[];avatar?:string};
export type Dialog = {id:string;name:string;members:string[]};
export type VoicePresence = {user:string;muted:boolean;deaf:boolean};
export type DialogCall = {id:string;dialog:string;caller:string;video:boolean;created_at:number;participants:string[];declined:string[];empty_since?:number};
export type DialogPreferences = {pinned:boolean;muted:boolean};
export type ChatPreferences = {revision?:number;notifications:{direct:boolean;groups:boolean};dialogs:Record<string,DialogPreferences>};
export type ChatState = {chatPreferences?:ChatPreferences;me:User;email:string;users:User[];groups:Group[];dialogs:Dialog[];messages:ChatMessage[];stickers:Sticker[];friends:Friend[];bots:Bot[];voicePresence?:Record<string,VoicePresence[]>;dialogCalls?:DialogCall[]};

export type AttachmentDraft = {name:string;data:string;mime?:string};
export type MessageAttachmentMetadata = {id:string;name:string;size:number;mime:string;expired?:boolean};
export type AttachmentFile = {data:string;mime:string;name:string};
export type ChatMessage = {id:string;channel:string;user:string;text:string;time:number;sticker?:string;attachment?:MessageAttachmentMetadata;bot_name?:string;reactions?:{user:string;emoji:string}[]};
export type Sticker = {id:string;owner:string;name:string;image?:string;group?:string;pack?:string;archived?:boolean;keywords?:string[]};
export type Friend = {id:string;from:string;to:string;accepted:boolean};
export type Bot = {id:string;name:string;username?:string;channel?:string;group?:string;groups?:string[];owner:string;commands?:BotCommand[];privacy?:string|boolean;last_seen?:number;enabled?:boolean};
