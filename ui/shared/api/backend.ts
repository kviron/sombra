import { invoke, isTauri } from '@tauri-apps/api/core';
export const session = () => localStorage.getItem('mines-session') || '';
export function clearSession() { localStorage.removeItem('mines-session'); sessionStorage.removeItem('mines-jwt'); window.dispatchEvent(new Event('authchange')); if(window.location.hash !== '#register') window.location.hash = '#login'; }
export async function api<T = any>(op: string, data: Record<string, unknown> = {}): Promise<T> {
 if (!isTauri()) {
   let response: Response;
   try {
     response = await fetch('/api', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,token:session(),...data}), signal: AbortSignal.timeout(15000)});
   } catch {
     throw new Error('Не удалось связаться с сервером. Проверьте соединение и попробуйте снова.');
   }
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
 catch (error) { if (String(error).includes('AUTH_REQUIRED')) clearSession(); throw new Error(String(error)); }
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
export type User = {id:string;name:string;bio:string;avatar?:string;created_at:number};
export type Channel = {id:string;name:string;kind:string};
export type Group = {id:string;name:string;owner:string;invite:string;members:string[];channels:Channel[]};
export type Dialog = {id:string;name:string;members:string[]};
export type ChatState = {me:User;email:string;users:User[];groups:Group[];dialogs:Dialog[];messages:ChatMessage[];stickers:Sticker[];friends:Friend[];bots:Bot[]};

export type ChatMessage = {id:string;channel:string;user:string;text:string;time:number;sticker?:string;bot_name?:string;reactions?:{user:string;emoji:string}[]};
export type Sticker = {id:string;owner:string;name:string;image:string};
export type Friend = {id:string;from:string;to:string;accepted:boolean};
export type Bot = {id:string;name:string;channel:string;owner:string};
