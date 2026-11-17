import {useEffect,useRef,useState} from 'react';
import {Download, File, FileWarning} from 'lucide-react';
import {invoke,isTauri} from '@tauri-apps/api/core';
import {toast} from 'sonner';
import {api,clearSession,type AttachmentFile,type MessageAttachmentMetadata} from '@/shared/api/backend';
import {Button} from '@/shared/ui/button';
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
 const [visible,setVisible]=useState(false),[preview,setPreview]=useState<string>(),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const isImage=imageMimes.has(attachment.mime);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[]);
 useEffect(()=>{
  if(!isImage||attachment.expired)return;
  const element=root.current;if(!element)return;
  if(typeof IntersectionObserver==='undefined')return; // explicit download remains available
  const observer=new IntersectionObserver(entries=>setVisible(entries.some(entry=>entry.isIntersecting)),{rootMargin:'100px'});
  observer.observe(element);return()=>observer.disconnect();
 },[isImage,attachment.expired]);
 useEffect(()=>{
  if(!visible||!isImage||attachment.expired||error)return;
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
 },[visible,isImage,attachment.expired,messageId,error]);
 async function download(){
  if(busy||attachment.expired)return;
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
   if(message.includes('AUTH_REQUIRED'))clearSession();
   if(mounted.current)setError(message.includes('AUTH_REQUIRED')?'Сессия завершена. Войдите снова.':message.replace(/^REMOTE_UNAVAILABLE:/,''));
  }
  finally{if(mounted.current)setBusy(false)}
 }
 return <div ref={root} className="message-attachment" aria-label="Вложение">
  {isImage&&!attachment.expired&&!error&&<div className="attachment-preview">{preview?<img src={preview} alt={attachment.name} loading="lazy" onError={()=>setError('Не удалось показать изображение. Файл можно скачать.')}/>:<span role="status">Предпросмотр изображения</span>}</div>}
  <div className="attachment-file-row">{attachment.expired?<FileWarning aria-hidden="true"/>:<File aria-hidden="true"/>}<div className="attachment-file-info"><strong title={attachment.name}>{attachment.name}</strong><small>{sizeLabel(attachment.size)}{attachment.expired?' · Файл больше недоступен':''}</small></div>
   {!attachment.expired&&<Button type="button" variant="ghost" size="icon" disabled={busy} aria-label={`Скачать ${attachment.name}`} title="Скачать файл" onClick={()=>void download()}><Download/></Button>}
  </div>
  {error&&!attachment.expired&&<p className="attachment-error" role="status">{error}</p>}
 </div>;
}
