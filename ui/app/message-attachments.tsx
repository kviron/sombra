import {useEffect,useRef,useState} from 'react';
import {Download,FileWarning,RotateCw,X} from 'lucide-react';
import {Dialog} from 'radix-ui';
import {invoke,isTauri} from '@tauri-apps/api/core';
import {toast} from 'sonner';
import {api,clearSession,type AttachmentFile,type MessageAttachmentMetadata} from '@/shared/api/backend';
import {session} from '@/shared/api/backend';
import {attachmentCacheGeneration,attachmentCacheWriteEpoch} from '@/shared/api/attachment-cache';
import {attachmentDownloadFailure} from '@/shared/lib/attachment-errors';
import {attachmentCategory} from '@/shared/lib/conversation-materials';
import {verifiedMediaBlob} from '@/shared/lib/attachment-media';
import {AudioPlayer,FileDownload,FileIconDisplay,FileName,FileRoot,FileSize,fileLabel} from '@/shared/ui/elements-media';
import {AttachmentPreviewCache} from './attachment-preview-cache';
import './message-attachments.css';

const previews=new AttachmentPreviewCache();
const previewScope=()=>JSON.stringify([session(),attachmentCacheGeneration(),attachmentCacheWriteEpoch()]);
let acceptedPreviewScope='';
function syncPreviewScope(){const next=previewScope();if(next!==acceptedPreviewScope){acceptedPreviewScope=next;previews.clear()}return next}
window.addEventListener('authchange',()=>{acceptedPreviewScope='';previews.clear()});
window.addEventListener('attachmentcachechange',()=>{acceptedPreviewScope='';previews.clear()});
const MAX_BYTES=10*1024*1024;
const imageMimes=new Set(['image/gif','image/png','image/jpeg','image/webp']);
// No history-wide payload cache. At most three requests decode concurrently.
let active=0;
const waiting:Array<()=>void>=[];
async function limited<T>(run:()=>Promise<T>):Promise<T>{
 if(active>=3)await new Promise<void>(resolve=>waiting.push(resolve));
 active++;
 try{return await run()}finally{active--;waiting.shift()?.()}
}
function fileBlob(file:AttachmentFile):Blob{
 if(typeof file.data!=='string'||file.data.length>Math.ceil(MAX_BYTES/3)*4)throw new Error('Некорректный размер вложения.');
 const binary=atob(file.data);
 if(binary.length>MAX_BYTES)throw new Error('Размер вложения превышает 10 МиБ.');
 const bytes=new Uint8Array(binary.length);
 for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
 return new Blob([bytes],{type:imageMimes.has(file.mime)?file.mime:'application/octet-stream'});
}
function safeName(name:string){return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').slice(0,240)||'Вложение'}
function cacheNote(attachment:MessageAttachmentMetadata){return attachment.expired?'Локальная копия · файл очищен на сервере':'Сохранено на этом устройстве'}
/** The only attachment save path: Tauri native save dialog or the authorised browser request. */
async function saveAttachment(messageId:string,alive:()=>boolean):Promise<string|undefined>{
 if(isTauri())return invoke<string>('save_message_attachment',{message:messageId});
 const file=await limited(()=>api<AttachmentFile>('attachment_file',{message:messageId}));
 if(!alive())return;
 const url=URL.createObjectURL(fileBlob(file));
 const anchor=document.createElement('a');anchor.href=url;anchor.download=safeName(file.name);anchor.rel='noopener';
 document.body.append(anchor);
 try{anchor.click()}finally{anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),30000)}
}
export type MessageAttachmentProps={messageId:string;attachment:MessageAttachmentMetadata};
export function MessageAttachment(props:MessageAttachmentProps){
 // Identity key resets only for a different file, not every history poll.
 return <AttachmentView key={props.messageId+':'+props.attachment.id} {...props}/>;
}
function AttachmentView({messageId,attachment}:MessageAttachmentProps){
 const root=useRef<HTMLDivElement>(null);
 const mounted=useRef(true);
 const [visible,setVisible]=useState(false),[preview,setPreview]=useState<string>(),[error,setError]=useState(''),[busy,setBusy]=useState(false),[open,setOpen]=useState(false);
 const trigger=useRef<HTMLButtonElement>(null);
 const isImage=imageMimes.has(attachment.mime);
 const isAudio=!isImage&&attachmentCategory(attachment.name,attachment.mime)==='audio';
 const available=!attachment.expired||!!attachment.cached;
 const previewActive=visible||open;
 const scope=previewScope();
 const [previewIdentity,setPreviewIdentity]=useState('');
 const lease=useRef<ReturnType<AttachmentPreviewCache['acquire']>|undefined>(undefined);
 const [retry,setRetry]=useState(0),[inViewport,setInViewport]=useState(false);
 const identity=JSON.stringify([scope,messageId,attachment.id,attachment.name,attachment.mime,attachment.size]);
 const shownPreview=previewIdentity===identity?preview:undefined;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[]);
 useEffect(()=>{
  if(!isImage||!available)return;
  const element=root.current;if(!element)return;
  if(typeof IntersectionObserver==='undefined'){setVisible(true);return;}
  let scrollRoot:HTMLElement|null=element.parentElement;
  while(scrollRoot&&!/(auto|scroll)/.test(getComputedStyle(scrollRoot).overflowY))scrollRoot=scrollRoot.parentElement;
  const observer=new IntersectionObserver(entries=>setVisible(entries.some(entry=>entry.isIntersecting)),{root:scrollRoot,rootMargin:'600px 0px'});
  const viewportObserver=new IntersectionObserver(entries=>setInViewport(entries.some(entry=>entry.isIntersecting)),{root:scrollRoot});
  observer.observe(element);viewportObserver.observe(element);return()=>{observer.disconnect();viewportObserver.disconnect()};
 },[isImage,available]);
 useEffect(()=>{
  syncPreviewScope();setPreview(undefined);setError('');setPreviewIdentity(identity);
  if(!isImage||!available)return;
  let alive=true;
  const owner={active:false,priority:0,notify:(url:string|undefined,reason?:unknown)=>{
   if(!alive)return;
   setPreview(url);
   if(reason)setError(reason instanceof Error?reason.message:'Не удалось загрузить вложение.');
  }};
  const handle=previews.acquire(identity,owner,()=>api<AttachmentFile>('attachment_file',{message:messageId}),value=>{
   const file=value as AttachmentFile;
   // Preserve the fetched raster MIME gate; never cache SVG, HTML or external URLs.
   if(!imageMimes.has(file.mime))throw new Error('Предпросмотр этого файла недоступен.');
   return fileBlob(file);
  },()=>previewScope()===scope);
  lease.current=handle;
  const reset=()=>{alive=false;handle.release();setPreview(undefined);setOpen(false)};
  window.addEventListener('authchange',reset);window.addEventListener('attachmentcachechange',reset);
  return()=>{alive=false;handle.release();if(lease.current===handle)lease.current=undefined;window.removeEventListener('authchange',reset);window.removeEventListener('attachmentcachechange',reset)};
 },[identity,isImage,available,retry]);
 useEffect(()=>{lease.current?.update(previewActive,open?3:inViewport?2:1)},[previewActive,open,inViewport,identity,isImage,available,retry]);
 useEffect(()=>{if(!available||!isImage)setOpen(false)},[available,isImage]);
 async function download(){
  if(busy||!available)return;
  setBusy(true);
  try{
   const path=await saveAttachment(messageId,()=>mounted.current);
   if(mounted.current&&path)toast.success('Файл сохранён в Загрузки',{description:path});
  }catch(reason){
   const failure=attachmentDownloadFailure(reason,'Не удалось скачать файл.');
   if(failure.authRequired&&mounted.current)clearSession();
   if(mounted.current)setError(failure.message);
  }
  finally{if(mounted.current)setBusy(false)}
 }
 if(isImage){
  const placeholder=<span className="attachment-image-placeholder" role="status">{!available?<><FileWarning aria-hidden="true"/>Изображение недоступно</>:error?'Не удалось загрузить изображение':'Загрузка изображения…'}</span>;
  const downloadButton=<button type="button" className="attachment-image-download" disabled={busy} aria-label={`Скачать ${attachment.name}`} title="Скачать изображение" onClick={event=>{event.stopPropagation();void download()}}><Download size={18}/></button>;
  return <div ref={root} className="message-attachment message-attachment-image" aria-label="Изображение">
   <div className="attachment-image-surface">
    <button ref={trigger} type="button" className="attachment-preview attachment-image-trigger" disabled={!available} aria-label={`Открыть фото ${attachment.name}`} onClick={()=>setOpen(true)}>{available&&shownPreview&&!error?<img src={shownPreview} alt="Изображение из переписки" onError={()=>setError('Не удалось показать изображение.')}/>:placeholder}</button>
    {available&&downloadButton}
    {available&&error&&<button type="button" className="attachment-image-retry" aria-label="Повторить загрузку изображения" onClick={()=>{setError('');setRetry(value=>value+1)}}><RotateCw size={18}/></button>}
   </div>
   {attachment.cached&&<p className="attachment-cache-status">{cacheNote(attachment)}</p>}
   <Dialog.Root open={open&&available} onOpenChange={setOpen}><Dialog.Portal><Dialog.Overlay className="attachment-viewer-overlay"/><Dialog.Content className="attachment-viewer material-viewer" onCloseAutoFocus={event=>{event.preventDefault();trigger.current?.focus()}}>
    <Dialog.Title className="attachment-visually-hidden">Просмотр изображения</Dialog.Title><Dialog.Description className="attachment-visually-hidden">Изображение из переписки. Нажмите Escape, чтобы закрыть просмотр.</Dialog.Description>
    <Dialog.Close asChild><button type="button" className="attachment-viewer-close" aria-label="Закрыть просмотр фото"><X size={20}/></button></Dialog.Close>
    <div className="attachment-viewer-image">{shownPreview&&!error?<img src={shownPreview} alt="Изображение из переписки" onError={()=>setError('Не удалось показать изображение.')}/>:placeholder}{downloadButton}{error&&<button type="button" className="attachment-image-retry" aria-label="Повторить загрузку изображения" onClick={()=>{setError('');setRetry(value=>value+1)}}><RotateCw size={18}/></button>}</div>
   </Dialog.Content></Dialog.Portal></Dialog.Root>
  </div>;
 }
 if(isAudio&&available)return <div ref={root} className="message-attachment message-attachment-card" aria-label="Аудио">
  <AttachmentAudio messageId={messageId} attachment={attachment}/>
 </div>;
 return <div ref={root} className="message-attachment message-attachment-card" aria-label="Вложение">
  <FileCard mime={attachment.mime} name={attachment.name} size={attachment.size} available={available} note={!available?'Файл больше недоступен':undefined} busy={busy} onDownload={()=>{void download()}}/>
  {attachment.cached&&<p className="attachment-cache-status">{cacheNote(attachment)}</p>}
  {error&&available&&<p className="attachment-error" role="status">{error}</p>}
 </div>;
}

type FileCardProps={mime:string;name:string;size:number;available:boolean;note?:string;busy?:boolean;onDownload?:()=>void};
/** assistant-ui Elements File surface; Sombra supplies size/name and its own safe download. */
function FileCard({mime,name,size,available,note,busy,onDownload}:FileCardProps){
 return <FileRoot className="attachment-file-card w-full bg-background">
  {available?<FileIconDisplay mimeType={mime}/>:<FileIconDisplay><FileWarning className="size-5"/></FileIconDisplay>}
  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
   <FileName title={name}>{name||fileLabel(mime)}</FileName>
   <span className="flex min-w-0 flex-wrap items-center gap-x-1.5">
    <FileSize bytes={size} className="text-xs"/>
    {note&&<span className="text-muted-foreground text-xs">{note}</span>}
   </span>
  </div>
  {available&&onDownload&&<FileDownload filename={name} busy={busy} onDownload={onDownload} className="size-8"/>}
 </FileRoot>;
}

/** Audio bytes are decoded once through the existing preview cache and shared by every card. */
function AttachmentAudio({messageId,attachment}:MessageAttachmentProps){
 const root=useRef<HTMLDivElement>(null);
 const mounted=useRef(true);
 const [url,setUrl]=useState<string>();
 const [error,setError]=useState('');
 const [failed,setFailed]=useState(false);
 const [playing,setPlaying]=useState(false);
 const [visible,setVisible]=useState(false);
 const [inViewport,setInViewport]=useState(false);
 const [busy,setBusy]=useState(false);
 const [retry,setRetry]=useState(0);
 const lease=useRef<ReturnType<AttachmentPreviewCache['acquire']>|undefined>(undefined);
 const scope=previewScope();
 const identity=JSON.stringify([scope,messageId,attachment.id,attachment.name,attachment.mime,attachment.size,'audio']);
 const [identityState,setIdentityState]=useState('');
 const shownUrl=identityState===identity?url:undefined;
 const player=!!shownUrl&&!failed;
 const pinned=visible||playing;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[]);
 useEffect(()=>{
  const element=root.current;if(!element)return;
  if(typeof IntersectionObserver==='undefined'){setVisible(true);setInViewport(true);return;}
  let scrollRoot:HTMLElement|null=element.parentElement;
  while(scrollRoot&&!/(auto|scroll)/.test(getComputedStyle(scrollRoot).overflowY))scrollRoot=scrollRoot.parentElement;
  const observer=new IntersectionObserver(entries=>setVisible(entries.some(entry=>entry.isIntersecting)),{root:scrollRoot,rootMargin:'600px 0px'});
  const viewportObserver=new IntersectionObserver(entries=>setInViewport(entries.some(entry=>entry.isIntersecting)),{root:scrollRoot});
  observer.observe(element);viewportObserver.observe(element);
  return()=>{observer.disconnect();viewportObserver.disconnect()};
 },[]);
 useEffect(()=>{
  syncPreviewScope();setUrl(undefined);setError('');setFailed(false);setPlaying(false);setIdentityState(identity);
  let alive=true;
  const owner={active:false,priority:0,notify:(next:string|undefined,reason?:unknown)=>{
   if(!alive)return;
   setUrl(next);
   if(reason)setError(attachmentDownloadFailure(reason,'Не удалось загрузить аудио.').message);
  }};
  const handle=previews.acquire(identity,owner,()=>api<AttachmentFile>('attachment_file',{message:messageId}),value=>{
   const blob=verifiedMediaBlob(value as AttachmentFile,attachment,'audio');
   if(!document.createElement('audio').canPlayType(blob.type))throw new Error('Этот формат не поддерживается браузером. Скачайте файл.');
   return blob;
  },()=>previewScope()===scope);
  lease.current=handle;
  const reset=()=>{alive=false;handle.release();setUrl(undefined);setPlaying(false)};
  window.addEventListener('authchange',reset);window.addEventListener('attachmentcachechange',reset);
  return()=>{alive=false;handle.release();if(lease.current===handle)lease.current=undefined;window.removeEventListener('authchange',reset);window.removeEventListener('attachmentcachechange',reset)};
 },[identity,retry]);
 useEffect(()=>{lease.current?.update(pinned,pinned?inViewport?2:1:0)},[pinned,inViewport,identity,retry]);
 async function download(){
  if(busy)return;
  setBusy(true);
  try{
   const path=await saveAttachment(messageId,()=>mounted.current);
   if(mounted.current&&path)toast.success('Файл сохранён в Загрузки',{description:path});
  }catch(reason){
   const failure=attachmentDownloadFailure(reason,'Не удалось скачать файл.');
   if(failure.authRequired&&mounted.current)clearSession();
   if(mounted.current)setError(failure.message);
  }
  finally{if(mounted.current)setBusy(false)}
 }
 return <div ref={root} className="attachment-audio">
  {player?<>
   <div className="attachment-player">
    <AudioPlayer src={shownUrl} title={attachment.name} className="dark:bg-background" onPlaybackStateChange={setPlaying} onPlaybackError={()=>{if(!mounted.current)return;setFailed(true);setPlaying(false);setError('Не удалось воспроизвести файл. Скачайте его.')}}/>
    <button type="button" className="attachment-player-download" disabled={busy} aria-label={`Скачать ${attachment.name}`} title="Скачать аудиофайл" onClick={event=>{event.stopPropagation();void download()}}><Download size={16}/></button>
   </div>
   <div className="attachment-audio-meta"><FileSize bytes={attachment.size}/>{attachment.cached?<span>· {cacheNote(attachment)}</span>:null}</div>
  </>:<FileCard mime={attachment.mime} name={attachment.name} size={attachment.size} available note={!error&&visible?'Загрузка аудио…':undefined} busy={busy} onDownload={()=>{void download()}}/>}
  {error&&<div className="attachment-audio-status"><p className="attachment-error" role="status">{error}</p>{!player&&!failed&&<button type="button" className="attachment-audio-retry" aria-label="Повторить загрузку аудио" title="Повторить загрузку" onClick={()=>{setError('');setRetry(value=>value+1)}}><RotateCw size={16}/></button>}</div>}
 </div>;
}
