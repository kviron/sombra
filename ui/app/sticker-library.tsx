import {useEffect,useRef,useState,type ChangeEvent} from 'react';
import {unzipSync} from 'fflate';
import {Button} from '@/shared/ui/button';
import {api,type Sticker} from '@/shared/api/backend';

const imageExtension=/\.(png|webp)$/i;
const maxImageSize=8*1024*1024;
const images=new Map<string,Promise<string>>();
window.addEventListener('authchange',()=>images.clear());

function loadImage(id:string){
 const cached=images.get(id);
 if(cached)return cached;
 const loaded=api<{image:string}>('sticker_image',{sticker:id}).then(result=>result.image).catch(error=>{images.delete(id);throw error});
 if(images.size>=256)images.delete(images.keys().next().value!);
 images.set(id,loaded);
 return loaded;
}

export function StickerImage({sticker,className}:{sticker:Sticker;className?:string}){
 const ref=useRef<HTMLImageElement>(null);
 const [image,setImage]=useState(sticker.image);
 useEffect(()=>{
  if(sticker.image)return;
  let active=true;
  const observer=new IntersectionObserver(entries=>{
   if(!entries.some(entry=>entry.isIntersecting))return;
   observer.disconnect();
   void loadImage(sticker.id).then(image=>{if(active)setImage(image)}).catch(()=>{});
  });
  observer.observe(ref.current!);
  return ()=>{active=false;observer.disconnect()};
 },[sticker.id,sticker.image]);
 return <img ref={ref} className={className} src={sticker.image||image} alt={sticker.name} draggable={false}/>;
}

type StickerFile={name:string;file:Blob;keywords?:string[]};
type ManifestItem={name?:string;file?:string;filename?:string;files?:{webp?:string;png?:string};keywords?:unknown};
function baseName(path:string){return path.split(/[\\/]/).pop()||path}
function titleFor(path:string){return baseName(path).replace(/\.[^.]+$/,'').trim()||'Стикер'}

async function stickerFiles(files:File[]):Promise<{items:StickerFile[];title?:string}>{
 if(files.length!==1||!/\.zip$/i.test(files[0].name))return {items:files.map(file=>({name:titleFor(file.name),file}))};
 const archive=files[0];
 if(archive.size>80*1024*1024)throw new Error('ZIP должен быть не больше 80 МБ.');
 let count=0,total=0;
 const unpacked=unzipSync(new Uint8Array(await archive.arrayBuffer()),{filter:entry=>{
  if(!imageExtension.test(entry.name)&&baseName(entry.name)!=='manifest.json'&&baseName(entry.name)!=='pack.json')return false;
  total+=entry.originalSize;
  if(++count>410||entry.originalSize>maxImageSize||total>100*1024*1024)throw new Error('В архиве слишком много данных.');
  return true;
 }});
 const manifestPath=Object.keys(unpacked).find(path=>['manifest.json','pack.json'].includes(baseName(path)));
 if(manifestPath){
  const manifest=JSON.parse(new TextDecoder().decode(unpacked[manifestPath]));
  const items:ManifestItem[]|undefined=Array.isArray(manifest)?manifest:manifest?.stickers;
  if(Array.isArray(items)){
   const directory=manifestPath.slice(0,manifestPath.lastIndexOf('/')+1);
   const selected=items.flatMap(entry=>{
    const file=entry?.files?.webp??entry?.files?.png??entry?.file??entry?.filename;
    if(typeof file!=='string')return [];
    const path=[directory+file,directory+'png/'+file,file].find(path=>unpacked[path]&&imageExtension.test(path));
    if(!path)return [];
    const keywords=Array.isArray(entry.keywords)?[...new Set(entry.keywords
     .filter((value):value is string=>typeof value==='string').map(value=>[...value.trim()].slice(0,48).join('')).filter(Boolean))].slice(0,24):undefined;
    return [{name:typeof entry.name==='string'&&entry.name.trim()?entry.name:titleFor(path),file:asStickerBlob(path,unpacked[path]),keywords}];
   });
   if(selected.length)return {items:selected,title:typeof manifest.name==='string'?manifest.name.trim():undefined};
  }
 }
 const items=Object.entries(unpacked).filter(([path])=>imageExtension.test(path)&&!path.startsWith('__MACOSX/')).sort(([a],[b])=>a.localeCompare(b,undefined,{numeric:true}))
  .map(([path,bytes])=>({name:titleFor(path),file:asStickerBlob(path,bytes)}));
 return {items};
}

function asStickerBlob(path:string,bytes:Uint8Array){
 return new Blob([Uint8Array.from(bytes)],{type:/\.webp$/i.test(path)?'image/webp':'image/png'});
}

async function encodeSticker(file:Blob){
 if(!['image/png','image/webp'].includes(file.type)||file.size>maxImageSize)throw new Error('Выберите PNG или WebP до 8 МБ.');
 const bitmap=await createImageBitmap(file);
 try{
  if(file.type==='image/webp'&&file.size<=256*1024&&Math.max(bitmap.width,bitmap.height)===512){
   return await new Promise<string>((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(String(reader.result));
    reader.onerror=()=>reject(new Error('Не удалось прочитать стикер.'));
    reader.readAsDataURL(file);
   });
  }
  const scale=512/Math.max(bitmap.width,bitmap.height);
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(bitmap.width*scale));
  canvas.height=Math.max(1,Math.round(bitmap.height*scale));
  const context=canvas.getContext('2d');
  if(!context)throw new Error('Не удалось обработать стикер.');
  context.drawImage(bitmap,0,0,canvas.width,canvas.height);
  return canvas.toDataURL('image/webp',0.86);
 }finally{bitmap.close()}
}

type LibraryProps={stickers:Sticker[];user:string;group?:string;refresh:()=>Promise<unknown>};
export function StickerLibrary({stickers,user,group,refresh}:LibraryProps){
 const [name,setName]=useState(''),[progress,setProgress]=useState(''),[error,setError]=useState('');
 const [busy,setBusy]=useState(false),[confirm,setConfirm]=useState<string>();
 const library=stickers.filter(sticker=>!sticker.archived&&(group?sticker.group===group:!sticker.group&&sticker.owner===user));
 const packs=new Map<string,Sticker[]>();
 for(const sticker of library){
  const pack=sticker.pack||'';
  const items=packs.get(pack);
  if(items)items.push(sticker);else packs.set(pack,[sticker]);
 }

 async function upload(event:ChangeEvent<HTMLInputElement>){
  const files=Array.from(event.target.files||[]);
  event.target.value='';
  if(!files.length||busy)return;
  setBusy(true);setError('');setProgress('Подготавливаем набор…');
  try{
   const {items,title}=await stickerFiles(files);
   const pack=[...(name.trim()||title||(files.length===1?titleFor(files[0].name):'Мои стикеры'))].slice(0,60).join('');
   if(!items.length||items.length>200)throw new Error('Добавьте от 1 до 200 изображений PNG или WebP.');
   const prepared:{name:string;image:string;keywords?:string[]}[]=[];
   for(const item of items)prepared.push({name:[...item.name.trim()].slice(0,40).join('')||'Стикер',image:await encodeSticker(item.file),keywords:item.keywords});
   let batch:typeof prepared=[],bytes=0,uploaded=0;
   async function send(){
    if(!batch.length)return;
    await api('import_sticker_pack',{group,pack,stickers:batch});
    uploaded+=batch.length;
    setProgress(`Загружено ${uploaded} из ${prepared.length}`);
    batch=[];bytes=0;
   }
   const encoder=new TextEncoder();
   for(const item of prepared){
    const size=encoder.encode(JSON.stringify(item)).length+1;
    if(batch.length===48||bytes+size>650_000)await send();
    batch.push(item);bytes+=size;
   }
   await send();
   await refresh();
   setName('');
   setProgress(`Набор «${pack}» загружен · ${items.length} стикеров`);
  }catch(e){setProgress('');setError((e as Error).message);await refresh().catch(()=>{})}
  finally{setBusy(false)}
 }

 async function remove(pack:string,sticker?:Sticker){
  setBusy(true);setError('');setProgress('');
  try{
   await api(sticker?'remove_sticker':'remove_sticker_pack',{group,pack,sticker:sticker?.id});
   await refresh();
   setConfirm(undefined);
  }catch(e){setError((e as Error).message)}
  finally{setBusy(false)}
 }

 return <section className="sticker-library">
  {!group&&<h2>Стикеры</h2>}
  <label>Название набора<input value={name} maxLength={60} onChange={event=>setName(event.target.value)} placeholder="Подставится из имени файла"/></label>
  <label className="sticker-upload">Импортировать ZIP или изображения
   <input type="file" accept=".zip,image/png,image/webp" multiple disabled={busy} onChange={event=>void upload(event)}/>
  </label>
  {progress&&<p role="status">{progress}</p>}
  {error&&<p role="alert">{error}</p>}
  {!packs.size&&<p>Пока нет стикеров.</p>}
  {[...packs].map(([pack,items])=><details key={pack} className="sticker-pack">
   <summary>{pack||'Без набора'} · {items.length}</summary>
   <div className="sticker-grid">
    {items.map(sticker=><div key={sticker.id} className="sticker-library-item"><StickerImage sticker={sticker}/>
     <Button type="button" size="xs" variant="ghost" aria-label={`Удалить стикер «${sticker.name}»`} disabled={busy} onClick={()=>void remove(pack,sticker)}>Удалить</Button>
    </div>)}
   </div>
   {pack&&(confirm===pack?<div className="sticker-remove-actions">
    <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={()=>setConfirm(undefined)}>Отмена</Button>
    <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={()=>void remove(pack)}>Подтвердить удаление</Button>
   </div>:<Button type="button" size="sm" variant="destructive" disabled={busy} onClick={()=>setConfirm(pack)}>Удалить набор</Button>)}
  </details>)}
 </section>;
}
