import { invoke, isTauri } from '@tauri-apps/api/core';
import {notifyAttachmentCacheChange,attachmentCacheWriteEpoch,acceptAttachmentCacheState,attachmentCacheGeneration,attachmentCacheNeedsState,readAttachmentCache,writeAttachmentCache,resetAttachmentCacheAccess,getBrowserAttachmentCacheInfo,setBrowserAttachmentCacheLimit,clearBrowserAttachmentCache,type CacheInfo} from './attachment-cache';
export type {CacheInfo} from './attachment-cache';
export {CacheUnavailable} from './attachment-cache';
export const getAttachmentCacheInfo=():Promise<CacheInfo>=>isTauri()?invoke('attachment_cache_info'):getBrowserAttachmentCacheInfo();
export async function setAttachmentCacheLimit(limitMiB:number):Promise<CacheInfo>{const result=await (isTauri()?invoke<CacheInfo>('set_attachment_cache_limit',{limitMiB}):setBrowserAttachmentCacheLimit(limitMiB));attachmentRequests.clear();notifyAttachmentCacheChange();return result}
export async function clearAttachmentCache():Promise<CacheInfo>{const result=await (isTauri()?invoke<CacheInfo>('clear_attachment_cache'):clearBrowserAttachmentCache());attachmentRequests.clear();notifyAttachmentCacheChange();return result}
let stateRequest=0,acceptedStateRequest=0,rawStateRequest=0,acceptedRawStateRequest=0;
const attachmentRequests=new Map<string,Promise<unknown>>();
export const session = () => localStorage.getItem('mines-session') || '';
export function clearSession() { resetAttachmentCacheAccess(); attachmentRequests.clear(); localStorage.removeItem('mines-session'); sessionStorage.removeItem('mines-jwt'); window.dispatchEvent(new Event('authchange')); if(window.location.hash !== '#register') window.location.hash = '#login'; }
export class ApiConnectionError extends Error {}
export async function api<T = any>(op:string,data:Record<string,unknown>={}):Promise<T>{
 if(isTauri()){
  try{return await invoke<T>('remote_api',{request:{op,token:session(),...data}})}catch(error){const message=String(error);if(message.includes('AUTH_REQUIRED'))clearSession();if(message.startsWith('REMOTE_UNAVAILABLE:'))throw new ApiConnectionError(message.slice(19));throw new Error(message)}
 }
 if(op==='login'||op==='register'||op==='logout'){resetAttachmentCacheAccess();attachmentRequests.clear()}
 const scope=attachmentCacheGeneration();const stateSequence=op==='state'?++stateRequest:0;
 if(op==='attachment_file'){
  const writeEpoch=attachmentCacheWriteEpoch();const key=JSON.stringify([scope,writeEpoch,data]);const existing=attachmentRequests.get(key);if(existing)return existing as Promise<T>;
  const request=(async()=>{
   if(attachmentCacheNeedsState())await browserRaw<ChatState>('state').then(state=>acceptAttachmentCacheState(state,scope));
   if(scope!==attachmentCacheGeneration())throw new Error('Сессия изменилась. Повторите загрузку.');
   const cached=await readAttachmentCache(String(data.message));if(scope!==attachmentCacheGeneration())throw new Error('Сессия изменилась.');if(cached)return cached as T;
   const file=await browserRaw<AttachmentFile>(op,data);file.cached=false;
   if(scope!==attachmentCacheGeneration())throw new Error('Сессия изменилась. Повторите загрузку.');
   await writeAttachmentCache(String(data.message),file,scope,writeEpoch);if(scope!==attachmentCacheGeneration())throw new Error('Сессия изменилась.');return file as T;
  })();attachmentRequests.set(key,request);try{return await request}finally{if(attachmentRequests.get(key)===request)attachmentRequests.delete(key)}
 }
 const result=await browserRaw<T>(op,data);if(op==='state'){if(stateSequence<acceptedStateRequest)throw new Error('История уже обновлена.');acceptedStateRequest=stateSequence;return await acceptAttachmentCacheState(result as unknown as ChatState,scope) as T}return result;
}
async function browserRaw<T>(op:string,data:Record<string,unknown>={}):Promise<T>{
 const scope=attachmentCacheGeneration(),sequence=op==='state'?++rawStateRequest:0;
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
   if (response.status === 401) { if(scope===attachmentCacheGeneration())clearSession(); throw new Error('Сессия завершена. Войдите снова.'); }
   if(result.error&&String(result.error).includes('AUTH_REQUIRED')&&scope===attachmentCacheGeneration())clearSession();
   else if((response.status===403||(op==='attachment_file'&&String(result.error||'').includes('Сообщение не найдено')))&&scope===attachmentCacheGeneration())resetAttachmentCacheAccess();
   if (!response.ok) throw new Error(result.error || 'Сервер недоступен');
   if (result.error) throw new Error(String(result.error));
   if (!('data' in result)) throw new Error('Некорректный ответ сервера. Попробуйте снова.');
   if(op==='state'){if(sequence<acceptedRawStateRequest)throw new Error('История уже обновлена.');acceptedRawStateRequest=sequence;}return result.data as T;
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
export type ImageCropArea = {x:number;y:number;width:number;height:number};
export type ProfileCoverMetadata = {id:string;mime:string;width:number;height:number;crop:ImageCropArea;animated:boolean;bytes:number};
export type ProfileCoverFile = ProfileCoverMetadata & {user:string;data:string};
export type User = {id:string;name:string;bio:string;avatar?:string;coverSupported?:boolean;cover?:ProfileCoverMetadata;created_at:number;online?:boolean;last_seen?:number;bot?:boolean;username?:string;commands?:BotCommand[]};
export type Channel = {id:string;name:string;kind:string};
export type GroupPermission = 'group.rename' | 'group.avatar' | 'channels.create_text' | 'channels.create_voice' | 'channels.rename' | 'channels.delete' | 'members.invite' | 'invite.rotate' | 'members.kick' | 'messages.delete_any' | 'stickers.manage' | 'bots.manage';
export type GroupRole = {id:string;name:string;permissions:GroupPermission[]};
export type Group = {id:string;name:string;owner:string;invite:string;members:string[];channels:Channel[];avatar?:string;roles?:GroupRole[];memberRoles?:Record<string,string>;rolesRevision?:number;membersCanInvite?:boolean;permissions?:GroupPermission[]};
export type Dialog = {id:string;name:string;members:string[];owner?:string;avatar?:string;revision?:number;unreadCount?:number};
export type VoicePresence = {user:string;muted:boolean;deaf:boolean};
export type DialogCall = {id:string;dialog:string;caller:string;video:boolean;created_at:number;participants:string[];declined:string[];empty_since?:number};
export type DialogPreferences = {pinned:boolean;muted:boolean};
export type ChatPreferences = {revision?:number;notifications:{direct:boolean;groups:boolean};dialogs:Record<string,DialogPreferences>};
export type ChatState = {conversationMemberSearchSupported?:boolean;dialogMetadataSupported?:boolean;humanTypingSupported?:boolean;humanTyping?:{user:string;channel:string;until:number}[];readReceiptsSupported?:boolean;botTyping?:{bot:string;channel:string;until:number}[];chatPreferences?:ChatPreferences;me:User;email:string;users:User[];groups:Group[];dialogs:Dialog[];messages:ChatMessage[];stickers:Sticker[];friends:Friend[];bots:Bot[];voicePresence?:Record<string,VoicePresence[]>;dialogCalls?:DialogCall[]};

export type AttachmentDraft = {name:string;data:string;mime?:string};
export type MessageAttachmentMetadata = {id:string;name:string;size:number;mime:string;expired?:boolean;cached?:boolean};
export type AttachmentFile = {data:string;mime:string;name:string;cached?:boolean};
export type ChatMessage = {readCount?:number;readAt?:number;id:string;channel:string;user:string;text:string;time:number;sticker?:string;attachment?:MessageAttachmentMetadata;bot_name?:string;reactions?:{user:string;emoji:string}[]};
export type Sticker = {id:string;owner:string;name:string;image?:string;group?:string;pack?:string;archived?:boolean;keywords?:string[]};
export type Friend = {id:string;from:string;to:string;accepted:boolean};
export type Bot = {id:string;name:string;username?:string;channel?:string;group?:string;groups?:string[];owner:string;commands?:BotCommand[];privacy?:string|boolean;last_seen?:number;enabled?:boolean;transportVersion?:number;managementVersion?:number};
