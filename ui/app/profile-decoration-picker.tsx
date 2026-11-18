import {useEffect,useRef,useState,type FormEvent} from 'react';
import {Dialog,ScrollArea} from 'radix-ui';
import {Check,Plus,Upload,X} from 'lucide-react';
import {createProfileEffect,createProfileEffectDraft,getProfileEffectDraft,listProfileEffects,session,setProfileEffectVisibility,uploadProfileEffect,type ProfileDecorationDoc,type ProfileEffect,type ProfileEffectAsset,type ProfileEffectDraft,type ProfileEffectTarget,type User} from '@/shared/api/backend';
import {DECORATION_PRESETS,normalizeDecoration} from '@/shared/ui/avatar-fx';
import {UserAvatar} from '@/shared/ui/user-avatar';
import {ProfileEffectImage,PROFILE_EFFECT_MAX_BYTES} from '@/shared/ui/profile-effect-image';
import {ProfileCover} from '@/shared/ui/profile-cover';
import {Button} from '@/shared/ui/button';
import '@/shared/ui/menu-material.css';
import './profile-decoration-picker.css';

export type MediaTarget=ProfileEffectTarget;
const OPTIONS={
 avatar:[['ember-crown','Огненная рамка'],['slime-pet','Слайм в углу']],
 cover:[['runner-cover','Бегущий герой'],['aurora-cover','Звёздное сияние']],
} as const;
type Choice={key:string;title:string;decoration:ProfileDecorationDoc|null;id?:string;asset?:ProfileEffectAsset};
type Page={items:ProfileEffect[];nextOffset:number|null};
type View='personal'|'catalog'|'create'|'upload';
const MAX_EFFECT_TITLE=64;

const asChoice=(item:ProfileEffect):Choice=>({key:`effect:${item.id}`,id:item.id,title:item.title,decoration:item.decoration,asset:item.asset});
function message(reason:unknown,fallback:string){return reason instanceof Error?reason.message:fallback}
function EffectSample({user,target,decoration,asset}:{user:User;target:MediaTarget;decoration:ProfileDecorationDoc|null;asset?:ProfileEffectAsset}){
 return <span className="profile-effect-sample" data-avatar-fx-priority="picker" aria-hidden="true">
  {target==='avatar'?<UserAvatar user={user} size="xl" presence={false} decorative decoration={decoration} effectAsset={null}/>:<ProfileCover user={user} accountId={user.id} decoration={decoration} effectAsset={null}/>}
  <ProfileEffectImage asset={asset} className="profile-effect-image"/>
 </span>;
}

export function ProfileDecorationPicker({user,target,catalogSupported,draftsSupported,uploadsSupported,onSave,onClose,onRestoreFocus}:{
 user:User;target:MediaTarget;catalogSupported?:boolean;draftsSupported?:boolean;uploadsSupported?:boolean;
 onSave:(doc:ProfileDecorationDoc|null,id?:string)=>Promise<void>;onClose:()=>void;onRestoreFocus:()=>void;
}){
 const [view,setView]=useState<View>('personal');
 const [file,setFile]=useState<File>(),[title,setTitle]=useState(''),[preview,setPreview]=useState('');
 const [fileError,setFileError]=useState('');
 const [page,setPage]=useState<Page>({items:[],nextOffset:null});
 const [recentUploads,setRecentUploads]=useState<ProfileEffect[]>([]);
 const displayedItems=view==='personal'?[...recentUploads.filter(item=>item.target===target),...page.items.filter(item=>!recentUploads.some(upload=>upload.id===item.id))]:page.items;
 const [pageLoading,setPageLoading]=useState(catalogSupported),[pageError,setPageError]=useState('');
 const [reload,setReload]=useState(0),[choice,setChoice]=useState<Choice>();
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [prompt,setPrompt]=useState(''),[draft,setDraft]=useState<ProfileEffectDraft>();
 const [pollError,setPollError]=useState('');
 const lock=useRef(false),heading=useRef<HTMLHeadingElement>(null),mounted=useRef(false);
 const pending=draft?.status==='queued'||draft?.status==='running';
 const draftReady=draft?.status==='ready'&&draft.result&&normalizeDecoration(draft.result.decoration,{target}).value?draft.result:undefined;
 const currentDoc=user.decorations?.[target]??null;
 const currentRef=user.decorationRefs?.[target];
 const sameDocument=(left:ProfileDecorationDoc|null,right:ProfileDecorationDoc|null)=>JSON.stringify(normalizeDecoration(left,{target}).value)===JSON.stringify(normalizeDecoration(right,{target}).value);
 const current=(item:Choice)=>item.id?item.id===currentRef:!currentRef&&sameDocument(item.decoration,currentDoc);
 const none={key:'none',title:target==='avatar'?'Без рамки':'Без эффекта',decoration:null};
 const presets:Choice[]=OPTIONS[target].map(([key,title])=>({key,title,decoration:DECORATION_PRESETS[key].decoration as ProfileDecorationDoc}));
 const localOptions:Choice[]=view==='catalog'?[]:target==='avatar'?[none,...presets]:[...presets,none];
 if(view==='personal'&&currentDoc&&!currentRef&&!presets.some(current))localOptions.splice(1,0,{key:'current',title:'Текущий эффект',decoration:currentDoc});

 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[]);
 useEffect(()=>{
  if(view!=='upload'||!file)return;
  let active=true,url='';
  void file.slice(0,6).text().then(signature=>{
   if(!active)return;
   if(!/^GIF8[79]a$/.test(signature)){setFileError('Выберите файл GIF.');setFile(undefined);return}
   if(window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
   url=URL.createObjectURL(file);setPreview(url);
  }).catch(()=>{if(active){setFileError('Не удалось прочитать GIF.');setFile(undefined)}});
  return()=>{active=false;if(url)URL.revokeObjectURL(url)};
 },[file,view]);
 useEffect(()=>{
  if(!catalogSupported||view==='create'||view==='upload')return;
  let active=true;
  const token=session();
  setPage({items:[],nextOffset:null});setPageLoading(true);setPageError('');
  void listProfileEffects(view,target).then(result=>{if(active&&session()===token)setPage(result)})
   .catch(reason=>{if(active&&session()===token)setPageError(message(reason,'Не удалось загрузить эффекты'))})
   .finally(()=>{if(active&&session()===token)setPageLoading(false)});
  return()=>{active=false};
 },[catalogSupported,view,target,reload]);

 useEffect(()=>{
  if(!pending||!draft||pollError)return;
  let active=true;
  const token=session();
  const timeout=window.setTimeout(()=>{
   void getProfileEffectDraft(draft.id).then(next=>{if(active&&session()===token)setDraft(next)})
    .catch(reason=>{if(active&&session()===token)setPollError(message(reason,'Не удалось проверить состояние черновика'))});
  },1800);
  return()=>{active=false;window.clearTimeout(timeout)};
 },[draft,pending,pollError]);

 async function run(action:(current:()=>boolean)=>Promise<void>){
  if(lock.current)return;
  const token=session(),valid=()=>mounted.current&&session()===token;
  lock.current=true;setBusy(true);setError('');setNotice('');
  try{await action(valid)}catch(reason){if(valid())setError(message(reason,'Не удалось выполнить действие'))}
  finally{lock.current=false;if(valid())setBusy(false)}
 }
 function switchView(next:View){
  if(next===view||lock.current)return;
  if(view==='upload'){setFile(undefined);setPreview('');setTitle('');setFileError('')}
  setChoice(undefined);setError('');setNotice('');setPage({items:[],nextOffset:null});setPageLoading(Boolean(catalogSupported&&(next==='personal'||next==='catalog')));setPageError('');setView(next);
 }
 function loadMore(){
  if(!catalogSupported||view==='create'||view==='upload'||page.nextOffset===null)return;
  const offset=page.nextOffset;
  void run(async valid=>{
   const result=await listProfileEffects(view,target,offset);
   if(valid())setPage(previous=>({nextOffset:result.nextOffset,items:[...previous.items,...result.items.filter(item=>!previous.items.some(old=>old.id===item.id))]}));
  });
 }
 function changeVisibility(item:ProfileEffect){
  void run(async valid=>{
   const {item:updated}=await setProfileEffectVisibility(item.id,!item.public);
   if(!valid())return;
   setRecentUploads(previous=>previous.map(row=>row.id===updated.id?updated:row));
   if(view==='catalog'&&!updated.public){setChoice(undefined);setReload(value=>value+1)}
   else setPage(previous=>({...previous,items:previous.items.map(row=>row.id===updated.id?updated:row)}));
   setNotice(updated.public?'Эффект опубликован в каталоге':'Эффект убран из каталога');
  });
 }
 function chooseFile(candidate?:File){
  setFile(undefined);setPreview('');setFileError('');setError('');
  if(!candidate)return;
  if(candidate.size>PROFILE_EFFECT_MAX_BYTES){setFileError('GIF должен быть не больше 2 МиБ.');return}
  if(candidate.size<6||(candidate.type&&candidate.type!=='image/gif')){setFileError('Выберите файл GIF.');return}
  setFile(candidate);
 }
 function upload(event:FormEvent){
  event.preventDefault();
  if(!uploadsSupported||!file||!title.trim())return;
  void run(async valid=>{
   if(!/^GIF8[79]a$/.test(await file.slice(0,6).text()))throw new Error('Выберите файл GIF.');
   const data=await new Promise<string>((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(String(reader.result).split(',')[1]??'');
    reader.onerror=reader.onabort=()=>reject(new Error('Не удалось прочитать GIF.'));
    reader.readAsDataURL(file);
   });
   if(!valid())return;
   const {item}=await uploadProfileEffect(target,title.trim(),data);
   if(!valid())return;
   setFile(undefined);setPreview('');setTitle('');setFileError('');
   setRecentUploads(previous=>[item,...previous]);setChoice(asChoice(item));setView('personal');
   setNotice('GIF добавлена в личную коллекцию. Чтобы использовать её, нажмите «Применить».');
  });
 }
 function generate(event:FormEvent){
  event.preventDefault();
  if(pending||!prompt.trim())return;
  void run(async valid=>{
   const next=await createProfileEffectDraft(target,prompt.trim());
   if(valid()){setPollError('');setDraft(next)}
  });
 }
 function saveDraft(){
  if(!draftReady)return;
  void run(async valid=>{
   await createProfileEffect(target,draftReady.title,draftReady.decoration);
   if(!valid())return;
   setDraft(undefined);setPrompt('');setView('personal');setNotice('Черновик сохранён в «Мои эффекты». Он не опубликован и не применён.');
  });
 }
 function apply(){
  if(!choice||current(choice))return;
  void run(async valid=>{await onSave(choice.decoration,choice.id);if(valid())onClose()});
 }
 function renderCard(item:Choice,record?:ProfileEffect){
  const selected=choice?.key===item.key||(!choice&&current(item));
  const card=<button key={item.key} type="button" className="profile-effect-card" aria-pressed={selected} disabled={busy} onClick={()=>{setChoice(item);setError('')}}>
    <EffectSample user={user} target={target} decoration={item.decoration} asset={item.asset}/>
    <span className="profile-effect-title"><span><strong>{item.title}</strong><small>{item.asset?'GIF-анимация':item.decoration?'Анимированный эффект':'Стандартный вид'}</small></span>{selected&&<Check size={16} aria-hidden="true"/>}</span>
   </button>;
  if(!record||record.ownerId!==user.id)return card;
  return <div className="profile-effect-entry" key={item.key}>
   {card}
   <div className="profile-effect-visibility">
    <span>{record.public?'В каталоге':'Личный'}</span>
    <button type="button" disabled={busy} aria-label={`${record.public?'Скрыть из каталога':'Опубликовать в каталоге'}: ${item.title}`} onClick={()=>changeVisibility(record)}>{record.public?'Скрыть':'Опубликовать'}</button>
   </div>
  </div>;
 }
 return <Dialog.Root open onOpenChange={open=>{if(!open&&!lock.current)onClose()}}>
  <Dialog.Portal>
   <Dialog.Overlay className="profile-effects-overlay"/>
   <Dialog.Content className="profile-effects-dialog dark" data-target={target} aria-busy={busy}
    onOpenAutoFocus={event=>{event.preventDefault();heading.current?.focus()}}
    onCloseAutoFocus={event=>{event.preventDefault();onRestoreFocus()}}
    onEscapeKeyDown={event=>{if(lock.current)event.preventDefault();event.stopPropagation()}}
    onInteractOutside={event=>{if(lock.current)event.preventDefault()}}>
    <ScrollArea.Root className="profile-effects-scroll" type="hover">
     <ScrollArea.Viewport className="profile-effects-viewport">
      <div className="profile-effects-body">
    <header>
     <div><Dialog.Title ref={heading} tabIndex={-1}>{view==='upload'?'Добавить свою GIF':target==='avatar'?'Эффект аватара':'Эффект обложки'}</Dialog.Title>
      <Dialog.Description>{view==='upload'?'Выберите файл и проверьте, как он выглядит.':'Выберите готовый эффект или добавьте свою анимацию.'}</Dialog.Description></div>
     <Dialog.Close asChild><Button type="button" variant="ghost" size="icon" disabled={busy} aria-label="Закрыть выбор эффекта"><X/></Button></Dialog.Close>
    </header>
    <div className="profile-effect-toolbar">
      <div className="profile-effect-tabs" role="group" aria-label="Коллекция эффектов">
       <button type="button" aria-pressed={view==='personal'} disabled={busy} onClick={()=>switchView('personal')}>Личное</button>
       <button type="button" aria-pressed={view==='catalog'} disabled={busy} onClick={()=>switchView('catalog')}>Общее</button>
      </div>
      <div className="profile-effect-actions">
       {draftsSupported&&<Button type="button" variant="ghost" aria-pressed={view==='create'} disabled={busy} onClick={()=>switchView('create')}>Создать эффект</Button>}
       <Button type="button" variant="outline" aria-pressed={view==='upload'} disabled={busy} onClick={()=>switchView('upload')}><Plus aria-hidden="true"/>Добавить свою GIF</Button>
      </div>
     </div>
     {view==='upload'?<form className="profile-effect-form" onSubmit={upload}>
      {uploadsSupported?<div className="profile-effect-upload">
       <Upload size={22} aria-hidden="true"/>
       <label htmlFor="profile-effect-file">Файл анимации</label>
       <input id="profile-effect-file" type="file" accept="image/gif,.gif" required disabled={busy} onChange={event=>chooseFile(event.currentTarget.files?.[0])}/>
       <p>GIF · до 2 МиБ. При сохранении эффект останется личным.</p>
       {fileError&&<p role="alert">{fileError}</p>}
       {file&&preview&&<div className="profile-effect-upload-preview"><img src={preview} alt="Предпросмотр GIF"/></div>}
       <label htmlFor="profile-effect-name">Название</label>
       <input id="profile-effect-name" type="text" required maxLength={MAX_EFFECT_TITLE} value={title} disabled={busy} onChange={event=>{setTitle(event.target.value);setError('')}} placeholder="Название эффекта"/>
      </div>:<p role="status">Этот сервер пока не поддерживает загрузку GIF. Готовые эффекты доступны в разделе «Личное».</p>}
      <footer><Button type="button" variant="ghost" disabled={busy} onClick={()=>switchView('personal')}>Назад</Button>
       {uploadsSupported&&<Button type="submit" disabled={busy||!file||!title.trim()}>Добавить в личное</Button>}</footer>
     </form>:view==='create'?<form className="profile-effect-form" onSubmit={generate}>
     <label htmlFor="profile-effect-prompt">Как должен выглядеть эффект?</label>
     <textarea id="profile-effect-prompt" rows={3} required maxLength={400} value={prompt} disabled={busy||pending} onChange={event=>{setPrompt(event.target.value);setDraft(undefined);setError('')}} placeholder={target==='avatar'?'Например, тёплые искры по краю аватара':'Например, звёзды над ночным городом'}/>
     <p>Сначала появится превью. Сохранённый черновик будет личным, пока вы не опубликуете его сами.</p>
     {pending&&<p role="status">{draft.status==='queued'?'Черновик в очереди…':'Создаём эффект…'}</p>}
     {pollError&&<p role="alert">{pollError} <Button type="button" variant="outline" onClick={()=>setPollError('')}>Проверить ещё раз</Button></p>}
     {draft?.status==='failed'&&<p role="alert">{draft.error||'Не удалось создать эффект. Попробуйте ещё раз.'}</p>}
     {draft?.status==='ready'&&!draftReady&&<p role="alert">Не удалось показать этот эффект. Попробуйте создать его снова.</p>}
     {draftReady&&<div className="profile-effect-draft"><EffectSample user={user} target={target} decoration={draftReady.decoration}/><strong>{draftReady.title}</strong></div>}
     <footer><Button type="submit" variant={draftReady?'outline':'default'} disabled={busy||pending||!prompt.trim()}>{draft?'Создать заново':'Создать превью'}</Button>
      {draftReady&&<Button type="button" disabled={busy} onClick={saveDraft}>Сохранить черновик</Button>}</footer>
    </form>:<>
     <div className="profile-effect-options" role="group" aria-label={target==='avatar'?'Рамки аватара':'Эффекты обложки'}>
      {localOptions.map(item=>renderCard(item))}
      {displayedItems.map(item=>renderCard(asChoice(item),item))}
     </div>
     {!catalogSupported&&view==='catalog'&&<p className="profile-effect-state" role="status">Этот сервер пока не поддерживает общий каталог. Готовые эффекты доступны в разделе «Личное».</p>}
      {pageLoading&&<p className="profile-effect-state" role="status">Загружаем эффекты…</p>}
     {pageError&&<div className="profile-effect-state" role="alert">{pageError} <Button type="button" variant="outline" disabled={busy} onClick={()=>setReload(value=>value+1)}>Повторить</Button></div>}
     {catalogSupported&&!pageLoading&&!pageError&&!displayedItems.length&&<p className="profile-effect-state">{view==='catalog'?'В каталоге пока нет эффектов для этого раздела.':'Здесь появятся созданные вами эффекты и эффекты, которые вы примените из каталога.'}</p>}
     {page.nextOffset!==null&&<Button type="button" variant="outline" disabled={busy||pageLoading} onClick={loadMore}>Показать ещё</Button>}
     <footer><Dialog.Close asChild><Button type="button" variant="ghost" disabled={busy}>Отмена</Button></Dialog.Close>
      <Button type="button" disabled={busy||!choice||current(choice)} onClick={apply}>Применить</Button></footer>
    </>}
    {error&&<p className="profile-effect-error" role="alert">{error}</p>}
    {notice&&<p className="profile-effect-state" role="status">{notice}</p>}
      </div>
     </ScrollArea.Viewport>
     <ScrollArea.Scrollbar className="profile-effects-scrollbar" orientation="vertical"><ScrollArea.Thumb className="profile-effects-thumb"/></ScrollArea.Scrollbar>
    </ScrollArea.Root>
   </Dialog.Content>
  </Dialog.Portal>
 </Dialog.Root>;
}
