import {useEffect,useState} from 'react';
import {FileText,LoaderCircle,X} from 'lucide-react';
import {Button} from '@/shared/ui/button';
import type {AttachmentDraft} from '@/shared/api/backend';
import {MAX_ATTACHMENT_SIZE} from './attachment-composer';
import {inspectImage} from '@/shared/lib/image-crop';

/** Decode only bounded raw base64; metadata never authorizes an image preview. */
export function decodeDraftBytes(data:string):Uint8Array|null {
 if(data.length>4*Math.ceil(MAX_ATTACHMENT_SIZE/3)||data.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(data))return null;
 try{const raw=atob(data);if(raw.length>MAX_ATTACHMENT_SIZE)return null;return Uint8Array.from(raw,char=>char.charCodeAt(0))}catch{return null}
}
export function draftImageMime(bytes:Uint8Array):string|undefined {
 const starts=(values:number[])=>values.every((value,index)=>bytes[index]===value);
 if(bytes.length>=8&&starts([137,80,78,71,13,10,26,10]))return 'image/png';
 if(bytes.length>=3&&starts([255,216,255]))return 'image/jpeg';
 if(bytes.length>=6&&starts([71,73,70,56])&&(bytes[4]===55||bytes[4]===57)&&bytes[5]===97)return 'image/gif';
 if(bytes.length>=12&&starts([82,73,70,70])&&bytes[8]===87&&bytes[9]===69&&bytes[10]===66&&bytes[11]===80)return 'image/webp';
}
export function draftByteSize(size:number):string {
 return size>=1024*1024?`${(size/(1024*1024)).toFixed(1)} МБ`:size>=1024?`${(size/1024).toFixed(1)} КБ`:`${size} Б`;
}
// Composer-only UI stays beside its single consumer, not in the shared UI kit.
export function AttachmentDraftPreview({draft,reading,disabled,onRemove}:{draft?:AttachmentDraft;reading?:boolean;disabled?:boolean;onRemove:()=>void}) {
 const [preview,setPreview]=useState<{draft:AttachmentDraft;url?:string;size:number}|null>(null);
 const [failed,setFailed]=useState<AttachmentDraft|null>(null);
 useEffect(()=>{
  if(!draft){setPreview(null);return}
  const bytes=decodeDraftBytes(draft.data),mime=bytes&&draftImageMime(bytes);
  let url:string|undefined;
  if(bytes&&mime){try{inspectImage(bytes,mime,'cover');url=URL.createObjectURL(new Blob([bytes as BlobPart],{type:mime}))}catch{/* Unsafe or complex images remain sendable file cards. */}}
  setPreview({draft,url,size:bytes?.length||0});
  return()=>{if(url)URL.revokeObjectURL(url)};
 },[draft]);
 if(!draft&&!reading)return null;
 const current=preview?.draft===draft?preview:null;
 const image=current?.url&&failed!==draft;
 return <div className="attachment-draft-preview" aria-label="Вложение перед отправкой">
  {draft&&<div className={`attachment-draft ${image?'attachment-draft-image':'attachment-draft-file'}`}>
   {image?<img src={current.url} alt={draft.name} onError={()=>setFailed(draft)}/>:<FileText className="attachment-draft-icon" aria-hidden="true"/>}
   <div className="attachment-draft-info"><strong className="attachment-draft-name" title={draft.name}>{draft.name}</strong><small className="attachment-draft-size">{current?draftByteSize(current.size):'Подготовка…'}</small></div>
   <Button type="button" className="attachment-draft-remove" variant="ghost" size="icon" disabled={disabled} aria-label="Убрать вложение" title="Убрать вложение" onClick={onRemove}><X aria-hidden="true"/></Button>
  </div>}
  {reading&&<div className="attachment-draft-reading" role="status"><LoaderCircle size={16} aria-hidden="true"/>Читаем файл…{!draft&&<Button type="button" variant="ghost" size="icon" className="attachment-draft-remove" aria-label="Убрать вложение" disabled={disabled} onClick={onRemove}><X aria-hidden="true"/></Button>}</div>}
 </div>;
}
