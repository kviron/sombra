import {useEffect,useRef,useState,type ChangeEvent} from 'react';
import {unzipSync} from 'fflate';
import {Dialog,ScrollArea,Tabs} from 'radix-ui';
import {ArrowLeft,Plus,Sticker as StickerIcon,Upload,X} from 'lucide-react';
import './sticker-catalog.css';
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

type PublicPack={id:string;name:string;owner:string;count:number;installed:boolean;stickers:Sticker[]};
const listPacks=(options:{packId?:string;offset?:number}={})=>api<{packs:PublicPack[];nextOffset:number|null}>('list_public_sticker_packs',options);
export const personalSticker=(sticker:Sticker,user:string)=>!sticker.group&&(sticker.owner===user||sticker.packInstalled===true);
export const stickerPackKey=(sticker:Sticker)=>sticker.packId||sticker.pack||'';

function StickerPackPreview({id,user,refresh,onClose,trigger}:{id:string;user:string;refresh:()=>Promise<unknown>;onClose:()=>void;trigger:React.RefObject<HTMLButtonElement|null>}){
 const [pack,setPack]=useState<PublicPack>(),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{
  let current=true;
  void listPacks({packId:id}).then(({packs})=>{if(current){setPack(packs[0]);if(!packs.length)setError('Этот набор больше не опубликован.')}}).catch(e=>{if(current)setError(e.message)});
  return ()=>{current=false};
 },[id]);
 async function install(){
  setBusy(true);setError('');
  try{await api('install_public_sticker_pack',{packId:id});await refresh();onClose()}
  catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 return <Dialog.Root open onOpenChange={open=>{if(!open)onClose()}}><Dialog.Portal>
  <Dialog.Overlay className="sticker-preview-overlay"/>
  <Dialog.Content className="sticker-preview-dialog" aria-describedby={undefined} onCloseAutoFocus={event=>{event.preventDefault();trigger.current?.focus({preventScroll:true})}}>
   <header><Dialog.Title>{pack?.name||'Набор стикеров'}</Dialog.Title><Dialog.Close asChild><Button size="icon-sm" variant="ghost" aria-label="Закрыть"><X/></Button></Dialog.Close></header>
   {error&&<p role="alert">{error}</p>}
   {!pack&&!error&&<p role="status">Загрузка…</p>}
   {pack&&<><div className="sticker-grid">{pack.stickers.map(sticker=><StickerImage key={sticker.id} sticker={sticker}/>)}</div>
    {pack.owner===user?<p>Ваш набор</p>:pack.installed?<p role="status">Набор уже добавлен</p>:<Button type="button" disabled={busy} onClick={()=>void install()}>Добавить в мои стикеры</Button>}</>}
  </Dialog.Content>
 </Dialog.Portal></Dialog.Root>;
}

export function SentSticker({sticker,user,catalog,refresh}:{sticker:Sticker;user:string;catalog?:boolean;refresh:()=>Promise<unknown>}){
 const [open,setOpen]=useState(false),trigger=useRef<HTMLButtonElement>(null);
 const id=sticker.packId;
 if(!catalog||!id||!sticker.packPublic||sticker.packAdded||personalSticker(sticker,user)||sticker.group)return <StickerImage className="sent-sticker" sticker={sticker}/>;
 return <><button ref={trigger} type="button" className="sent-sticker-preview" aria-label={`Открыть набор «${sticker.pack}»`} onClick={()=>setOpen(true)}><StickerImage className="sent-sticker" sticker={sticker}/></button>
  {open&&<StickerPackPreview key={id} user={user} id={id} refresh={refresh} trigger={trigger} onClose={()=>setOpen(false)}/>}</>;
}

function PackArt({stickers}:{stickers:Sticker[]}){
 return <span className="sticker-collection-art" aria-hidden="true">{stickers.length?stickers.slice(0,4).map(sticker=><StickerImage key={sticker.id} sticker={sticker}/>):<StickerIcon/>}</span>;
}

function PublicStickerCatalog({user,refresh}:{user:string;refresh:()=>Promise<unknown>}){
 const [packs,setPacks]=useState<PublicPack[]>([]),[next,setNext]=useState<number|null>(null),[busy,setBusy]=useState(true),[error,setError]=useState('');
 const [preview,setPreview]=useState<string>(),trigger=useRef<HTMLButtonElement|null>(null);
 const [generation,setGeneration]=useState(0),[offset,setOffset]=useState(0);
 useEffect(()=>{
  let current=true;
  setBusy(true);setError('');
  void listPacks({offset}).then(({packs,nextOffset})=>{if(current){setPacks(previous=>offset?[...new Map([...previous,...packs].map(pack=>[pack.id,pack])).values()]:packs);setNext(nextOffset)}}).catch(e=>{if(current)setError(e.message)}).finally(()=>{if(current)setBusy(false)});
  return ()=>{current=false};
 },[offset,generation,user]);
 return <section aria-label="Публичные наборы" className="public-sticker-catalog">
  {error&&<p role="alert">{error}</p>}
  {busy&&<p role="status">Загрузка…</p>}
  {!packs.length&&!busy&&!error&&<p>Пока нет опубликованных наборов.</p>}
  <div className="sticker-collection-tiles">{packs.map(pack=><button key={pack.id} type="button" className="sticker-collection-tile" onClick={event=>{trigger.current=event.currentTarget;setPreview(pack.id)}}>
   <PackArt stickers={pack.stickers}/>
   <span className="sticker-collection-label"><strong>{pack.name}</strong><small>{pack.count} шт.{pack.owner===user?' · Ваш набор':pack.installed?' · Добавлен':''}</small></span>
  </button>)}</div>
  {error?<Button size="sm" variant="outline" onClick={()=>setGeneration(n=>n+1)}>Повторить</Button>:next!==null&&<Button size="sm" variant="outline" disabled={busy} onClick={()=>setOffset(next)}>Ещё наборы</Button>}
  {preview&&<StickerPackPreview user={user} id={preview} trigger={trigger} onClose={()=>setPreview(undefined)} refresh={async()=>{await refresh();setPacks(rows=>rows.map(pack=>pack.id===preview?{...pack,installed:true}:pack))}}/>}
 </section>;
}

type LibraryProps={stickers:Sticker[];user:string;group?:string;catalog?:boolean;refresh:()=>Promise<unknown>};
export function StickerLibrary({stickers,user,group,catalog,refresh}:LibraryProps){
 const [name,setName]=useState(''),[progress,setProgress]=useState(''),[error,setError]=useState('');
 const [busy,setBusy]=useState(false),[confirm,setConfirm]=useState<string>();
 const [tab,setTab]=useState('library'),[adding,setAdding]=useState(false);
 const addTrigger=useRef<HTMLButtonElement>(null);
 const library=stickers.filter(sticker=>!sticker.archived&&(group?sticker.group===group:personalSticker(sticker,user)));
 const packs=new Map<string,Sticker[]>();
 for(const sticker of library){
  const pack=stickerPackKey(sticker);
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

 async function changePack(sticker:Sticker){
  setBusy(true);setError('');setProgress('');
  try{
   if(sticker.packInstalled)await api('remove_installed_sticker_pack',{packId:sticker.packId});
   else await api('set_sticker_pack_public',{packId:sticker.packId,pack:sticker.pack,public:!sticker.packPublic});
   await refresh();
  }catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 const importForm=<>
  <label className="sticker-pack-name">Название набора<input value={name} maxLength={60} disabled={busy} onChange={event=>setName(event.target.value)} placeholder="Подставится из имени файла"/></label>
  <label className="sticker-upload"><Upload size={18} aria-hidden="true"/>Импортировать ZIP или изображения
   <input type="file" accept=".zip,image/png,image/webp" multiple disabled={busy} onChange={event=>void upload(event)}/>
  </label>
 </>;
 const feedback=<>{progress&&<p role="status">{progress}</p>}{error&&<p role="alert">{error}</p>}</>;
 const packList=<div className={group?undefined:'sticker-collection-tiles'}>
  {[...packs].map(([key,items])=>{const source=items[0],pack=source.pack||'',added=!group&&source.packInstalled;return <details key={key} className="sticker-pack">
   {group?<summary>{pack||'Без набора'} · {items.length}</summary>:<summary className="sticker-collection-tile">
    <PackArt stickers={items}/><span className="sticker-collection-label"><strong>{pack||'Без набора'}</strong><small>{items.length} шт.{added?' · Добавлен':source.packPublic?' · Опубликован':''}</small></span>
   </summary>}
   <div className="sticker-grid">
    {items.map(sticker=><div key={sticker.id} className="sticker-library-item"><StickerImage sticker={sticker}/>
     {!added&&<Button type="button" size="xs" variant="ghost" aria-label={`Удалить стикер «${sticker.name}»`} disabled={busy} onClick={()=>void remove(pack,sticker)}>Удалить</Button>}
    </div>)}
   </div>
   {!group&&catalog&&source.packId&&<Button type="button" size="sm" variant="outline" disabled={busy} onClick={()=>void changePack(source)}>{added?'Убрать из моих стикеров':source.packPublic?'Снять с публикации':'Опубликовать'}</Button>}
    {!added&&pack&&(confirm===key?<div className="sticker-remove-actions">
    <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={()=>setConfirm(undefined)}>Отмена</Button>
    <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={()=>void remove(pack)}>Подтвердить удаление</Button>
   </div>:<Button type="button" size="sm" variant="destructive" disabled={busy} onClick={()=>setConfirm(key)}>Удалить набор</Button>)}
  </details>})}
 </div>;
 if(group)return <section className="sticker-library">{importForm}{feedback}{!packs.size&&<p>Пока нет стикеров.</p>}{packList}</section>;
 return <section className="sticker-library sticker-collection">
  {adding?<div className="sticker-collection-import">
   {importForm}{feedback}
   <Button type="button" variant="ghost" disabled={busy} onClick={()=>{setAdding(false);requestAnimationFrame(()=>addTrigger.current?.focus())}}><ArrowLeft/>Назад к наборам</Button>
  </div>:<Tabs.Root value={tab} onValueChange={setTab}>
   <div className="sticker-collection-toolbar settings-sticker-banner"><div className="settings-sticker-intro"><StickerIcon aria-hidden="true"/><div><strong>Свой набор</strong><p>Загрузите ZIP-архив со стикерами.</p></div></div>

    <Button ref={addTrigger} type="button" variant="outline" disabled={busy} onClick={()=>{setTab('library');setProgress('');setError('');setAdding(true)}}><Plus/>Добавить свой набор</Button>
   </div>
   <h2 className="settings-sticker-heading">Коллекция стикеров</h2>
<Tabs.List className="sticker-collection-tabs" aria-label="Коллекция стикеров"><Tabs.Trigger value="library">Личное</Tabs.Trigger><Tabs.Trigger value="catalog">Общее</Tabs.Trigger></Tabs.List>
    <Tabs.Content value="library" className="sticker-collection-panel">
    {feedback}{!packs.size&&<p className="sticker-collection-empty">Пока нет личных наборов. Импортируйте свой набор или найдите его в общем каталоге.</p>}{packList}
   </Tabs.Content>
   <Tabs.Content value="catalog" className="sticker-collection-panel">
    {catalog?<PublicStickerCatalog key={user} user={user} refresh={refresh}/>:<p className="sticker-collection-empty">Этот сервер пока не поддерживает общий каталог стикеров.</p>}
   </Tabs.Content>
  </Tabs.Root>}
 </section>;
}

export function StickerCollectionModal({open,onOpenChange,...props}:Omit<LibraryProps,'group'>&{open:boolean;onOpenChange:(open:boolean)=>void}){
 const opener=useRef<HTMLElement|null>(null);
 return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal>
  <Dialog.Overlay className="sticker-collection-overlay"/>
  <Dialog.Content className="sticker-collection-modal" onOpenAutoFocus={()=>{opener.current=document.activeElement instanceof HTMLElement?document.activeElement:null}} onCloseAutoFocus={event=>{if(opener.current?.isConnected){event.preventDefault();opener.current.focus({preventScroll:true})}}}>
   <ScrollArea.Root className="sticker-collection-scroll">
    <ScrollArea.Viewport className="sticker-collection-viewport">
     <div className="sticker-collection-frame">
      <header><div><Dialog.Title>Коллекция стикеров</Dialog.Title><Dialog.Description>Управляйте личными наборами и находите новые в общем каталоге.</Dialog.Description></div>
       <Dialog.Close asChild><Button type="button" variant="ghost" size="icon-lg" aria-label="Закрыть коллекцию стикеров"><X/></Button></Dialog.Close>
      </header>
      <StickerLibrary key={props.user} {...props}/>
     </div>
    </ScrollArea.Viewport>
    <ScrollArea.Scrollbar orientation="vertical" className="sticker-collection-scrollbar"><ScrollArea.Thumb className="sticker-collection-thumb"/></ScrollArea.Scrollbar>
   </ScrollArea.Root>
  </Dialog.Content>
 </Dialog.Portal></Dialog.Root>;
}