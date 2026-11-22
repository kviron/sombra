import {useMemo} from 'react';
import {ComposerAttachments,ComposerAttachmentChip} from '@/shared/ui/elements-composer';
import type {AttachmentDraft} from '@/shared/types';
import {MAX_ATTACHMENT_SIZE} from './attachment-composer';

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
// Native files retain the upstream generic file chip, never a large image card.
export function AttachmentDraftPreview({draft,reading,disabled,onRemove}:{draft?:AttachmentDraft;reading?:boolean;disabled?:boolean;onRemove:()=>void}) {
 const data=draft?.data;
 const size=useMemo(()=>data===undefined?undefined:decodeDraftBytes(data)?.length,[data]);
 if(!draft&&!reading)return null;
 return <ComposerAttachments aria-label="Вложение перед отправкой"><ComposerAttachmentChip attachment={{name:draft?.name||'Читаем файл…',meta:reading?'Читаем файл…':draftByteSize(size||0),state:reading?'uploading':'done'}} onRemove={disabled?undefined:onRemove}/></ComposerAttachments>;
}
