import {useEffect,useRef,useState} from 'react';
import {Download, File, FileWarning, RotateCw, X} from 'lucide-react';
import {Dialog} from 'radix-ui';
import {invoke,isTauri} from '@tauri-apps/api/core';
import {toast} from 'sonner';
import {api,clearSession,type AttachmentFile,type MessageAttachmentMetadata} from '@/shared/api/backend';
import {Button} from '@/shared/ui/button';
import {session} from '@/shared/api/backend';
import {attachmentCacheGeneration} from '@/shared/api/attachment-cache';
import {attachmentCategory} from '@/shared/lib/conversation-materials';
import {verifiedMediaBlob} from '@/shared/lib/attachment-media';
import './message-attachments.css';

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
function sizeLabel(size:number){return size>=1024*1024?`${(size/1024/1024).toFixed(1)} МиБ`:`${Math.ceil(size/1024)} КиБ`}
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
 const available=!attachment.expired||!!attachment.cached;
 const previewActive=visible||open;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[]);
 useEffect(()=>{
  if(!isImage||!available)return;
  const element=root.current;if(!element)return;
  if(typeof IntersectionObserver==='undefined'){setVisible(true);return;}
  const observer=new IntersectionObserver(entries=>setVisible(entries.some(entry=>entry.isIntersecting)),{rootMargin:'100px'});
  observer.observe(element);return()=>observer.disconnect();
 },[isImage,available]);
 useEffect(()=>{
  if(!previewActive||!isImage||!available||error)return;
  let cancelled=false,url:string|undefined;
  void limited(async()=>{
   if(cancelled)return;
   const file=await api<AttachmentFile>('attachment_file',{message:messageId});
   if(cancelled)return;
   // Both server metadata AND fetched server MIME must be raster image MIME.
   if(!imageMimes.has(file.mime))throw new Error('Предпросмотр этого файла недоступен.');
   url=URL.createObjectURL(fileBlob(file));setPreview(url);
  }).catch(reason=>{if(!cancelled)setError(reason instanceof Error?reason.message:'Не удалось загрузить вложение.')});
  return()=>{cancelled=true;if(url)URL.revokeObjectURL(url);setPreview(undefined)};
 },[previewActive,isImage,available,messageId,error]);
 useEffect(()=>{if(!available||!isImage)setOpen(false)},[available,isImage]);
 async function download(){
  if(busy||!available)return;
  setBusy(true);
  try{
   if(isTauri()){
    const path=await invoke<string>('save_message_attachment',{message:messageId});
    if(mounted.current)toast.success('Файл сохранён в Загрузки',{description:path});
    return;
   }
   const file=await limited(()=>api<AttachmentFile>('attachment_file',{message:messageId}));
   if(!mounted.current)return;
   const url=URL.createObjectURL(fileBlob(file));
   const anchor=document.createElement('a');anchor.href=url;anchor.download=safeName(file.name);anchor.rel='noopener';
   document.body.append(anchor);
   try{anchor.click()}finally{anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),30000)}
  }catch(reason){
   const message=reason instanceof Error?reason.message:String(reason||'Не удалось скачать файл.');
   if(mounted.current&&message.includes('AUTH_REQUIRED'))clearSession();
   if(mounted.current)setError(message.includes('AUTH_REQUIRED')?'Сессия завершена. Войдите снова.':message.replace(/^REMOTE_UNAVAILABLE:/,''));
  }
  finally{if(mounted.current)setBusy(false)}
 }
 if(isImage){
  const placeholder=<span className="attachment-image-placeholder" role="status">{!available?<><FileWarning aria-hidden="true"/>Изображение недоступно</>:error?'Не удалось загрузить изображение':'Загрузка изображения…'}</span>;
  const downloadButton=<button type="button" className="attachment-image-download" disabled={busy} aria-label={`Скачать ${attachment.name}`} title="Скачать изображение" onClick={event=>{event.stopPropagation();void download()}}><Download size={18}/></button>;
  return <div ref={root} className="message-attachment message-attachment-image" aria-label="Изображение">
   <div className="attachment-image-surface">
    <button ref={trigger} type="button" className="attachment-preview attachment-image-trigger" disabled={!available} aria-label={`Открыть фото ${attachment.name}`} onClick={()=>setOpen(true)}>{available&&preview&&!error?<img src={preview} alt="Изображение из переписки" onError={()=>setError('Не удалось показать изображение.')}/>:placeholder}</button>
    {available&&downloadButton}
    {available&&error&&<button type="button" className="attachment-image-retry" aria-label="Повторить загрузку изображения" onClick={()=>setError('')}><RotateCw size={18}/></button>}
   </div>
   {attachment.cached&&<p className="attachment-cache-status">{attachment.expired?'Локальная копия · файл очищен на сервере':'Сохранено на этом устройстве'}</p>}
   <Dialog.Root open={open&&available} onOpenChange={setOpen}><Dialog.Portal><Dialog.Overlay className="attachment-viewer-overlay"/><Dialog.Content className="attachment-viewer material-viewer" onCloseAutoFocus={event=>{event.preventDefault();trigger.current?.focus()}}>
    <Dialog.Title className="attachment-visually-hidden">Просмотр изображения</Dialog.Title><Dialog.Description className="attachment-visually-hidden">Изображение из переписки. Нажмите Escape, чтобы закрыть просмотр.</Dialog.Description>
    <Dialog.Close asChild><button type="button" className="attachment-viewer-close" aria-label="Закрыть просмотр фото"><X size={20}/></button></Dialog.Close>
    <div className="attachment-viewer-image">{preview&&!error?<img src={preview} alt="Изображение из переписки" onError={()=>setError('Не удалось показать изображение.')}/>:placeholder}{downloadButton}{error&&<button type="button" className="attachment-image-retry" aria-label="Повторить загрузку изображения" onClick={()=>setError('')}><RotateCw size={18}/></button>}</div>
   </Dialog.Content></Dialog.Portal></Dialog.Root>
  </div>;
 }
 return <div ref={root} className="message-attachment" aria-label="Вложение">
  <div className="attachment-file-row">{!available?<FileWarning aria-hidden="true"/>:<File aria-hidden="true"/>}<div className="attachment-file-info"><strong title={attachment.name}>{attachment.name}</strong><small>{sizeLabel(attachment.size)}{!available?' · Файл больше недоступен':''}</small></div>
   {available&&<Button type="button" variant="ghost" size="icon" disabled={busy} aria-label={`Скачать ${attachment.name}`} title="Скачать файл" onClick={()=>void download()}><Download/></Button>}
  </div>
  {attachment.cached&&<p className="attachment-cache-status">{attachment.expired?'Локальная копия · файл очищен на сервере':'Сохранено на этом устройстве'}</p>}
  {available&&<AttachmentMedia messageId={messageId} attachment={attachment}/>}
  {error&&available&&<p className="attachment-error" role="status">{error}</p>}
 </div>;
}

function AttachmentMedia({messageId,attachment}:MessageAttachmentProps){
 const category=attachmentCategory(attachment.name,attachment.mime);
 const kind=category==='audio'?'audio':category==='videos'?'video':null;
 const [url,setUrl]=useState(''),[loading,setLoading]=useState(false),[error,setError]=useState('');
 const media=useRef<HTMLMediaElement|null>(null),revision=useRef(0),objectUrl=useRef('');
 const alive=useRef(true);
 function stop(){revision.current++;const element=media.current;if(element){element.pause();element.removeAttribute('src');element.load()}if(objectUrl.current)URL.revokeObjectURL(objectUrl.current);objectUrl.current=''}
 useEffect(()=>{
  alive.current=true;setUrl('');setLoading(false);setError('');
  const reset=()=>{stop();setUrl('');setLoading(false)};
  window.addEventListener('authchange',reset);
  return()=>{alive.current=false;stop();window.removeEventListener('authchange',reset)};
 },[messageId,attachment.id,attachment.name,attachment.mime,attachment.size,attachment.expired,attachment.cached]);
 async function open(){
  if(!kind||loading||attachment.expired&&!attachment.cached)return;
  const epoch=++revision.current,token=session(),scope=attachmentCacheGeneration();setLoading(true);setError('');
  const current=()=>alive.current&&revision.current===epoch&&session()===token&&attachmentCacheGeneration()===scope;
  try{
   const file=await limited(()=>current()?api<AttachmentFile>('attachment_file',{message:messageId}):Promise.reject(new Error('Сессия изменилась.')));
   if(!current())return;
   const blob=verifiedMediaBlob(file,attachment,kind);
   if(!document.createElement(kind).canPlayType(blob.type))throw new Error('Этот формат не поддерживается браузером. Скачайте файл.');
   objectUrl.current=URL.createObjectURL(blob);setUrl(objectUrl.current);
  }catch(reason){if(current())setError(reason instanceof Error?reason.message:'Не удалось открыть файл. Скачайте его.')}
  finally{if(current())setLoading(false)}
 }
 function failed(){stop();setUrl('');setError('Не удалось воспроизвести файл или кодек не поддерживается. Скачайте файл.')}
 if(!kind)return null;
 return <div className="attachment-media">
  {!url&&!error&&<Button type="button" variant="ghost" disabled={loading} onClick={()=>void open()} aria-label={`Открыть ${attachment.name}`}>{loading?'Загрузка…':kind==='audio'?'Открыть аудио':'Открыть видео'}</Button>}
  {url&&(kind==='audio'?<audio ref={element=>{media.current=element}} src={url} controls preload="none" onError={failed} aria-label={attachment.name}/>:<video ref={element=>{media.current=element}} src={url} controls preload="none" playsInline onError={failed} aria-label={attachment.name}/>)}
  {error&&<p className="attachment-error" role="status">{error}</p>}
 </div>;
}
