import type {AttachmentFile,MessageAttachmentMetadata} from '../api/backend.ts';
export const MAX_MEDIA_BYTES=10*1024*1024;
const aliases:Record<string,string>={'audio/x-wav':'audio/wav','audio/wave':'audio/wav','audio/mp3':'audio/mpeg','audio/x-flac':'audio/flac','audio/x-m4a':'audio/mp4','video/quicktime':'video/mp4'};
const canonical=(mime:string)=>aliases[mime.toLowerCase()]||mime.toLowerCase();
/** Only local, bounded byte payloads. Metadata/extension alone never authorizes playback. */
export function verifiedMediaBlob(file:AttachmentFile,metadata:MessageAttachmentMetadata,kind:'audio'|'video'):Blob{
 if(file.name!==metadata.name||typeof file.data!=='string'||file.data.length>Math.ceil(MAX_MEDIA_BYTES/3)*4||!Number.isSafeInteger(metadata.size)||metadata.size<1||metadata.size>MAX_MEDIA_BYTES)throw new Error('Размер или имя файла не совпадает с вложением.');
 const binary=atob(file.data);
 if(binary.length!==metadata.size||binary.length>MAX_MEDIA_BYTES)throw new Error('Размер файла не совпадает с вложением.');
 const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
 const text=(offset:number,value:string)=>value.split('').every((char,index)=>bytes[offset+index]===char.charCodeAt(0));
 let mime='';
 if(kind==='audio'){
  if(bytes.length>=12&&text(0,'RIFF')&&text(8,'WAVE'))mime='audio/wav';
  else if(bytes.length>=4&&(text(0,'ID3')||(bytes[0]===255&&(bytes[1]&0xe0)===0xe0&&(bytes[1]&6)!==0&&(bytes[2]&0xf0)!==0xf0&&(bytes[2]&0xf0)!==0&&(bytes[2]&12)!==12)))mime='audio/mpeg';
  else if(bytes.length>=27&&text(0,'OggS'))mime='audio/ogg';
  else if(bytes.length>=4&&text(0,'fLaC'))mime='audio/flac';
 }
 if(!mime&&bytes.length>=12&&text(4,'ftyp'))mime=kind+'/mp4';
 if(!mime&&bytes.length>=4&&bytes[0]===0x1a&&bytes[1]===0x45&&bytes[2]===0xdf&&bytes[3]===0xa3)mime=kind+'/webm';
 const compatible=(value:string)=>value==='application/octet-stream'||canonical(value)===mime||(mime==='audio/ogg'&&value==='audio/opus');
 if(!mime||!compatible(file.mime)||!compatible(metadata.mime))throw new Error('Формат файла не подтверждён. Скачайте файл для открытия.');
 return new Blob([bytes],{type:mime});
}
