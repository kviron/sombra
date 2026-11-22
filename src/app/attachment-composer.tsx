import {useRef, type ClipboardEvent} from 'react';
import {Paperclip} from 'lucide-react';
import {ComposerIconButton} from '@/shared/ui/elements-composer';
import type {AttachmentDraft} from '@/shared/api/backend';
import './message-attachments.css';

export const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
/** Returns the wire payload (raw base64, without a data URL prefix). */
export async function readAttachment(file: File): Promise<AttachmentDraft> {
 if(file.size > MAX_ATTACHMENT_SIZE) throw new Error('Размер файла не должен превышать 10 МиБ.');
 return new Promise((resolve,reject)=>{
  const reader=new FileReader();
  reader.onerror=()=>reject(new Error('Не удалось прочитать файл.'));
  reader.onabort=()=>reject(new Error('Чтение файла отменено.'));
  reader.onload=()=>{
   const result=String(reader.result), comma=result.indexOf(',');
   if(comma<0){reject(new Error('Не удалось прочитать файл.'));return}
   resolve({name:file.name||'Вложение',data:result.slice(comma+1),mime:file.type||undefined});
  };
  reader.readAsDataURL(file);
 });
}
/** Call from the parent's textarea onPaste; normal text paste is not intercepted. */
export function pastedAttachment(event: ClipboardEvent<HTMLTextAreaElement>): File | undefined {
 const file=event.clipboardData.files[0];
 if(file)event.preventDefault();
 return file;
}
export type AttachmentComposerProps = {
 draft?: AttachmentDraft;
 disabled?: boolean;
 reading?: boolean;
 /** Parent owns async reads and destination/race handling. */
 onFile: (file: File) => void;
 onRemove: () => void;
};
export function AttachmentComposer({disabled,reading,onFile}:AttachmentComposerProps){
 const input=useRef<HTMLInputElement>(null);
 return <div className="attachment-composer">
  <input ref={input} type="file" hidden disabled={disabled||reading} onChange={event=>{const file=event.currentTarget.files?.[0];event.currentTarget.value='';if(file)onFile(file)}}/>
  <ComposerIconButton disabled={disabled||reading} title="Прикрепить файл (до 10 МиБ)" aria-label="Прикрепить файл (до 10 МиБ)" onClick={()=>input.current?.click()}><Paperclip size={16}/></ComposerIconButton>
 </div>;
}
