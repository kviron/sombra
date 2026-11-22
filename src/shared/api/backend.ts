import { invoke, isTauri } from '@tauri-apps/api/core';
import {createAvatarCache} from './avatars';
import {notifyAttachmentCacheChange,attachmentCacheWriteEpoch,acceptAttachmentCacheState,attachmentCacheGeneration,attachmentCacheNeedsState,readAttachmentCache,writeAttachmentCache,resetAttachmentCacheAccess,getBrowserAttachmentCacheInfo,setBrowserAttachmentCacheLimit,clearBrowserAttachmentCache,type CacheInfo} from './attachment-cache';
export type {CacheInfo} from './attachment-cache';
export {CacheUnavailable} from './attachment-cache';
export const getAttachmentCacheInfo=():Promise<CacheInfo>=>isTauri()?invoke('attachment_cache_info'):getBrowserAttachmentCacheInfo();
export async function setAttachmentCacheLimit(limitMiB:number):Promise<CacheInfo>{const result=await (isTauri()?invoke<CacheInfo>('set_attachment_cache_limit',{limitMiB}):setBrowserAttachmentCacheLimit(limitMiB));attachmentRequests.clear();notifyAttachmentCacheChange();return result}
export async function clearAttachmentCache():Promise<CacheInfo>{const result=await (isTauri()?invoke<CacheInfo>('clear_attachment_cache'):clearBrowserAttachmentCache());attachmentRequests.clear();notifyAttachmentCacheChange();return result}
let stateRequest=0,acceptedStateRequest=0,rawStateRequest=0,acceptedRawStateRequest=0;
const attachmentRequests=new Map<string,Promise<unknown>>();
// Several places read the same snapshot at nearly the same moment (a poll tick and a
// notification activation, say). One request answers them all; mutating ops are never merged.
const readOperations=new Set(['state','music_state','music_file','sessions','get_bot_settings','bot_get_model_settings','message_readers','list_public_sticker_packs','search_conversation_members','sticker_image']);
const readRequests=new Map<string,Promise<unknown>>();
/** Pictures are fetched once per version: see avatars.ts. */
const avatars=createAvatarCache(async ref=>api<{kind:string;id:string;sha:string;data:string}>('avatar_file',{kind:ref.kind,id:ref.id,sha:ref.sha}));
export const session = () => localStorage.getItem('mines-session') || '';
export function clearSession() { resetAttachmentCacheAccess(); attachmentRequests.clear(); readRequests.clear(); avatars.clear(); localStorage.removeItem('mines-session'); sessionStorage.removeItem('mines-jwt'); window.dispatchEvent(new Event('authchange')); if(window.location.hash !== '#register') window.location.hash = '#login'; }
export class ApiConnectionError extends Error {}
export async function api<T = any>(op:string,data:Record<string,unknown>={}):Promise<T>{
 // Ask polling snapshots for avatar hashes instead of inline pictures.
 const payload=op==='state'?{avatar_assets:true,...data}:data;
 if(!readOperations.has(op))return perform<T>(op,payload);
 const key=op+'\n'+JSON.stringify(payload);
 const shared=readRequests.get(key);
 if(shared)return shared as Promise<T>;
 const request=perform<T>(op,payload);
 readRequests.set(key,request);
 try{return await request}
 finally{if(readRequests.get(key)===request)readRequests.delete(key)}
}
async function perform<T>(op:string,payload:Record<string,unknown>):Promise<T>{
 if(isTauri()){
  let result:T;
  try{result=await invoke<T>('remote_api',{request:{op,token:session(),...payload}})}catch(error){const message=String(error);if(message.includes('AUTH_REQUIRED'))clearSession();if(message.startsWith('REMOTE_UNAVAILABLE:'))throw new ApiConnectionError(message.slice(19));throw new Error(message)}
  return op==='state'?await avatars.hydrate(result) as T:result;
 }
 if(op==='login'||op==='register'||op==='logout'){resetAttachmentCacheAccess();attachmentRequests.clear()}
 const scope=attachmentCacheGeneration();const stateSequence=op==='state'?++stateRequest:0;
 if(op==='attachment_file'){
  const writeEpoch=attachmentCacheWriteEpoch();const key=JSON.stringify([scope,writeEpoch,payload]);const existing=attachmentRequests.get(key);if(existing)return existing as Promise<T>;
  const request=(async()=>{
   if(attachmentCacheNeedsState())await browserRaw<ChatState>('state').then(state=>acceptAttachmentCacheState(state,scope));
   if(scope!==attachmentCacheGeneration())throw new Error('Сессия изменилась. Повторите загрузку.');
   const cached=await readAttachmentCache(String(payload.message));if(scope!==attachmentCacheGeneration())throw new Error('Сессия изменилась.');if(cached)return cached as T;
   const file=await browserRaw<AttachmentFile>(op,payload);file.cached=false;
   if(scope!==attachmentCacheGeneration())throw new Error('Сессия изменилась. Повторите загрузку.');
   await writeAttachmentCache(String(payload.message),file,scope,writeEpoch);if(scope!==attachmentCacheGeneration())throw new Error('Сессия изменилась.');return file as T;
  })();attachmentRequests.set(key,request);try{return await request}finally{if(attachmentRequests.get(key)===request)attachmentRequests.delete(key)}
 }
 const result=await browserRaw<T>(op,payload);if(op==='state'){if(stateSequence<acceptedStateRequest)throw new Error('История уже обновлена.');acceptedStateRequest=stateSequence;const accepted=await acceptAttachmentCacheState(result as unknown as ChatState,scope);return await avatars.hydrate(accepted) as T}return result;
}
async function browserRaw<T>(op:string,data:Record<string,unknown>={}):Promise<T>{
 const scope=attachmentCacheGeneration(),sequence=op==='state'?++rawStateRequest:0;
let response: Response;
   try {
     response = await fetch('/api', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,token:session(),...data}), signal: AbortSignal.timeout(op==='voice_poll'?5000:op==='attachment_file'||(op==='message'&&data.attachment)?90000:op==='state'?30000:15000)});
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
 avatars.clear();
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
/** Документ украшения профиля v1: пиксельная рамка аватара или сцена обложки. Разбор и проверка — avatar-fx/normalize.ts; сервер отдаёт только белый список полей. */
export type ProfileDecorationDoc = {v?:unknown;target?:unknown;mode?:unknown;loop?:unknown;seed?:unknown;layers?:unknown};
/** Украшения профиля по целям. Поле отсутствует — украшения нет; неизвестные цели сервер не отдаёт. */
export type ProfileDecorations = {avatar?:ProfileDecorationDoc;cover?:ProfileDecorationDoc};
export type ProfileEffectTarget = keyof ProfileDecorations;
export type ProfileEffectScope = 'personal'|'catalog';
export type ProfileEffectRefs = Partial<Record<ProfileEffectTarget,string>>;
export type ProfileEffectAsset={id:string;mime:'image/gif';width:number;height:number;frames:number;size:number};
export type ProfileEffect = {id:string;target:ProfileEffectTarget;title:string;decoration:ProfileDecorationDoc|null;asset?:ProfileEffectAsset;ownerId:string;public:boolean};
export const uploadProfileEffect=(target:ProfileEffectTarget,title:string,data:string)=>api<{item:ProfileEffect}>('upload_profile_effect',{target,title,data});
export const profileEffectFile=(id:string)=>api<{asset:ProfileEffectAsset;data:string}>('profile_effect_file',{id});
export type ProfileEffectDraft = {id:string;status:'queued'|'running'|'ready'|'failed';result?:{title:string;decoration:ProfileDecorationDoc};error?:string};
export const listProfileEffects=(scope:ProfileEffectScope,target:ProfileEffectTarget,offset=0)=>api<{items:ProfileEffect[];nextOffset:number|null}>('list_profile_effects',{scope,target,offset,limit:12});
export const createProfileEffect=(target:ProfileEffectTarget,title:string,decoration:ProfileDecorationDoc)=>api<{item:ProfileEffect}>('create_profile_effect',{target,title,decoration});
export const setProfileEffectVisibility=(id:string,isPublic:boolean)=>api<{item:ProfileEffect}>(isPublic?'publish_profile_effect':'unpublish_profile_effect',{id});
export const applyProfileEffect=(id:string)=>api<{item:ProfileEffect;user:User}>('apply_profile_effect',{id});
export const createProfileEffectDraft=(target:ProfileEffectTarget,prompt:string)=>api<ProfileEffectDraft>('create_profile_effect_draft',{target,prompt});
export const getProfileEffectDraft=(id:string)=>api<ProfileEffectDraft>('get_profile_effect_draft',{id});
export type User = {id:string;name:string;bio:string;avatar?:string;/** Content hash of the avatar when the server withholds the inline picture. */avatarHash?:string;coverSupported?:boolean;decorationSupported?:boolean;cover?:ProfileCoverMetadata;decorations?:ProfileDecorations;decorationRefs?:ProfileEffectRefs;profileEffectAssets?:Partial<Record<ProfileEffectTarget,ProfileEffectAsset>>;created_at:number;online?:boolean;last_seen?:number;bot?:boolean;username?:string;commands?:BotCommand[]};
export type Channel = {id:string;name:string;kind:string;unreadCount?:number;unreadMentionCount?:number};
export type GroupPermission = 'group.rename' | 'group.avatar' | 'channels.create_text' | 'channels.create_voice' | 'channels.rename' | 'channels.delete' | 'members.invite' | 'invite.rotate' | 'members.kick' | 'messages.delete_any' | 'stickers.manage' | 'bots.manage';
export type GroupRole = {id:string;name:string;permissions:GroupPermission[]};
export type Group = {id:string;name:string;owner:string;invite:string;members:string[];channels:Channel[];avatar?:string;avatarHash?:string;roles?:GroupRole[];memberRoles?:Record<string,string>;rolesRevision?:number;membersCanInvite?:boolean;permissions?:GroupPermission[]};
export type Dialog = {id:string;name:string;members:string[];owner?:string;avatar?:string;revision?:number;unreadCount?:number;unreadMentionCount?:number};
export type VoicePresence = {user:string;muted:boolean;deaf:boolean};
export type DialogCall = {id:string;dialog:string;caller:string;video:boolean;created_at:number;participants:string[];declined:string[];empty_since?:number};
export type DialogPreferences = {pinned:boolean;muted:boolean};
export type ChatPreferences = {revision?:number;notifications:{direct:boolean;groups:boolean};dialogs:Record<string,DialogPreferences>};
export type ChatState = {features?:{messageReferences?:boolean;/** Snapshot carries avatar hashes instead of inline pictures. */avatarAssets?:boolean};profileEffectUploadsSupported?:boolean;stickerCatalogSupported?:boolean;effectCatalogSupported?:boolean;profileEffectDraftsSupported?:boolean;decorationSupported?:boolean;conversationMemberSearchSupported?:boolean;dialogMetadataSupported?:boolean;humanTypingSupported?:boolean;humanTyping?:{user:string;channel:string;until:number}[];readReceiptsSupported?:boolean;botTyping?:{bot:string;channel:string;until:number}[];chatPreferences?:ChatPreferences;me:User;email:string;users:User[];groups:Group[];dialogs:Dialog[];messages:ChatMessage[];stickers:Sticker[];friends:Friend[];bots:Bot[];voicePresence?:Record<string,VoicePresence[]>;dialogCalls?:DialogCall[]};

export type AttachmentDraft = {name:string;data:string;mime?:string};
export type MessageAttachmentMetadata = {id:string;name:string;size:number;mime:string;expired?:boolean;cached?:boolean};
export type AttachmentFile = {data:string;mime:string;name:string;cached?:boolean};
export type MessageReply = {id:string;author?:string;text?:string};
export type ChatMessage = {replyTo?:MessageReply;forwardedFrom?:{author:string};gif?:string;mentions?:{userId:string;start:number;end:number}[];readCount?:number;readAt?:number;id:string;channel:string;user:string;text:string;time:number;sticker?:string;attachment?:MessageAttachmentMetadata;bot_name?:string;reactions?:{user:string;emoji:string}[]};
export type Sticker = {id:string;owner:string;name:string;image?:string;group?:string;pack?:string;archived?:boolean;keywords?:string[];packId?:string;packPublic?:boolean;packInstalled?:boolean;packAdded?:boolean};
export type Friend = {id:string;from:string;to:string;accepted:boolean};
export type Bot = {id:string;name:string;username?:string;channel?:string;group?:string;groups?:string[];owner:string;commands?:BotCommand[];privacy?:string|boolean;last_seen?:number;enabled?:boolean;transportVersion?:number;managementVersion?:number;modelSettings?:BotModelSettings};
/** Модель и уровень размышления бота: app/BOT-MODEL-SETTINGS.md. */
export type BotReasoning = '' | 'low' | 'medium' | 'high';
/** Безопасная проекция bot.settings (сырой settings сервер не отдаёт); revision независима от settings_revision профиля. `models` — необязательный каталог, который публикует провайдер/плагин, backend его не хранит. */
export type BotModelSettings = {model:string;reasoning:BotReasoning;revision:number;modelDefault:boolean;reasoningDefault:boolean;models?:string[]};
