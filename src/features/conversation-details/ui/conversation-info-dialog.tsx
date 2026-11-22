import {useEffect,useRef,useState} from 'react';
import {Dialog as DialogPrimitive} from 'radix-ui';
import {Camera,ChevronRight,File,Headphones,Image,Link2,Pencil,Settings,Video,X} from 'lucide-react';
import {api,type ChatMessage,type ChatState,type Dialog,type User} from '@/shared/api/backend';
import {conversationMaterials,type MaterialCategory} from '@/entities/message';
import {UserAvatar} from '@/shared/ui/user-avatar';
import {Button} from '@/shared/ui/button';
import {peerStatus} from '@/entities/conversation';
import {ImageCropDialog} from '@/shared/ui/image-crop-dialog';
import './conversation-info-dialog.css';

export function participantCount(count:number){const mod=count%100,last=count%10;return `${count} ${mod>=11&&mod<=14?'участников':last===1?'участник':last>=2&&last<=4?'участника':'участников'}`}
const categories=[{id:'photos',label:'Фото',icon:Image},{id:'videos',label:'Видео',icon:Video},{id:'files',label:'Файлы',icon:File},{id:'audio',label:'Аудио',icon:Headphones},{id:'links',label:'Ссылки',icon:Link2}] as const;
export type ProfileConversationMaterials={messages:ChatMessage[];channel:string;onOpen:(category:MaterialCategory)=>void};
export function ConversationMaterialRows({messages,channel,onOpen}:ProfileConversationMaterials){
 const items=conversationMaterials(messages,channel);
 if(!items.length)return null;
 return <section className="conversation-info-materials" aria-label="Материалы этой переписки"><h3>Материалы переписки</h3>{categories.filter(({id})=>items.some(item=>item.category===id)).map(({id,label,icon:Icon})=><button type="button" key={id} data-material-category={id} onClick={()=>onOpen(id)}><Icon size={19}/><span>{label}</span><small>{items.filter(item=>item.category===id).length}</small><ChevronRight size={16}/></button>)}<p>По сообщениям этой переписки. Недоступные вложения учитываются, если сохранились их метаданные.</p></section>;
}
type Props={state:ChatState;title:string;channel:string;memberIds:string[];avatar?:string;channelLabel?:string;dialog?:Dialog;onSaved?:(owner:string,dialog:Dialog)=>Promise<void>;onClose:()=>void;onProfile:(id:string)=>void;onMaterials:(category:MaterialCategory)=>void;onSettings?:()=>void};
export function ConversationInfoDialog({state,title,channel,memberIds,avatar,channelLabel,dialog,onSaved,onClose,onProfile,onMaterials,onSettings}:Props){
 const [editing,setEditing]=useState(false),[name,setName]=useState(''),[image,setImage]=useState(''),[revision,setRevision]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState(''),[crop,setCrop]=useState<File>();
 const [memberQuery,setMemberQuery]=useState(''),[memberResult,setMemberResult]=useState<{key:string;users:User[];error?:string}>();
 const normalizedQuery=memberQuery.trim().toLocaleLowerCase(),emailQuery=/^[^\s@]+@[^\s@]+$/.test(normalizedQuery),searchKey=`${state.me.id}:${channel}:${normalizedQuery}:${memberIds.join(',')}`;
 const memberSearchEpoch=useRef(0);
 useEffect(()=>{
  const epoch=++memberSearchEpoch.current;
  if(!emailQuery||!state.conversationMemberSearchSupported)return;
  const timer=setTimeout(()=>{void api<{users:User[]}>('search_conversation_members',{channel,query:normalizedQuery}).then(result=>{
   if(memberSearchEpoch.current===epoch&&alive.current)setMemberResult({key:searchKey,users:result.users.filter(user=>memberIds.includes(user.id))});
  }).catch(reason=>{if(memberSearchEpoch.current===epoch&&alive.current)setMemberResult({key:searchKey,users:[],error:reason instanceof Error?reason.message:'Не удалось найти участников.'})})},250);
  return()=>{clearTimeout(timer);if(memberSearchEpoch.current===epoch)memberSearchEpoch.current++};
 },[searchKey,emailQuery,state.conversationMemberSearchSupported]);
 const remoteResult=memberResult?.key===searchKey?memberResult:undefined;
 const localMemberIds=memberIds.filter(id=>{const user=id===state.me.id?state.me:state.users.find(item=>item.id===id);return !normalizedQuery||!!user&&`${user.name} ${user.username||''} @${user.username||''}`.toLocaleLowerCase().includes(normalizedQuery)});
 const shownMemberIds=emailQuery?(state.conversationMemberSearchSupported?remoteResult?.users.map(user=>user.id)||[]:[]):localMemberIds;
 const searchPending=emailQuery&&state.conversationMemberSearchSupported&&!remoteResult;
 const picker=useRef<HTMLInputElement>(null),camera=useRef<HTMLButtonElement>(null),editTrigger=useRef<HTMLButtonElement>(null),nameInput=useRef<HTMLInputElement>(null),close=useRef<HTMLButtonElement>(null),lock=useRef(false),alive=useRef(true);
 const scope=`${state.me.id}:${channel}`,scopeRef=useRef(scope);scopeRef.current=scope;
 const editable=!!onSaved&&state.dialogMetadataSupported===true&&!!dialog&&dialog.owner===state.me.id&&!state.me.bot&&dialog.members.length>2&&dialog.members.length<=10&&dialog.members.includes(state.me.id)&&dialog.members.every(id=>id===state.me.id||state.users.some(user=>user.id===id&&!user.bot));
 const live=useRef({editable,dialog});live.current={editable,dialog};
 useEffect(()=>{alive.current=true;const invalidate=()=>{alive.current=false};window.addEventListener('authchange',invalidate);return()=>{alive.current=false;window.removeEventListener('authchange',invalidate)}},[]);
 useEffect(()=>{setEditing(false);setCrop(undefined);setError('');setBusy(false);setMemberQuery('');setMemberResult(undefined);lock.current=false},[scope]);
 useEffect(()=>{if(editing&&/CONFLICT|Диалог изменён/i.test(error))setRevision(dialog?.revision||0)},[dialog?.revision,editing,error]);
 function restoreEdit(){requestAnimationFrame(()=>editTrigger.current?.focus())}
 function cancel(){if(lock.current)return;setEditing(false);setCrop(undefined);setError('');restoreEdit()}
 function begin(){if(!editable||!dialog)return;setName(dialog.name);setImage(dialog.avatar||'');setRevision(dialog.revision||0);setError('');setEditing(true);requestAnimationFrame(()=>nameInput.current?.focus())}
 function closeCrop(){setCrop(undefined);requestAnimationFrame(()=>camera.current?.focus())}
 async function save(){
  const current=live.current.dialog;if(lock.current||!live.current.editable||!current||!onSaved||!name.trim()||name.trim().length>60)return;
  const owner=state.me.id,destination=current.id,requestScope=scope;lock.current=true;setBusy(true);setError('');
  const valid=()=>alive.current&&scopeRef.current===requestScope&&live.current.editable&&live.current.dialog?.id===destination;
  try{
   const result=await api<Dialog>('update_dialog',{dialog:destination,revision,name:name.trim(),avatar:image});
   if(!valid())return;
   if(result.id!==destination||result.owner!==owner||!Number.isSafeInteger(result.revision))throw new Error('Не удалось подтвердить сохранение чата.');
   await onSaved(owner,result);
   if(valid()){setEditing(false);restoreEdit()}
  }catch(reason){if(valid()){setError(reason instanceof Error?reason.message:'Не удалось сохранить чат. Черновик сохранён.');if(live.current.dialog)setRevision(live.current.dialog.revision||0)}}
  finally{if(alive.current&&scopeRef.current===requestScope){lock.current=false;setBusy(false)}}
 }
 const previewName=editing?name:title,previewAvatar=editing?image:avatar;
 return <DialogPrimitive.Root open onOpenChange={open=>{if(!open&&!busy&&!crop){if(editing)cancel();else onClose()}}}><DialogPrimitive.Portal><DialogPrimitive.Overlay className="modal-backdrop conversation-info-backdrop"/><DialogPrimitive.Content className="conversation-info-dialog conversation-info-positioned" aria-describedby={undefined} onOpenAutoFocus={event=>{event.preventDefault();close.current?.focus()}} onEscapeKeyDown={event=>{if(busy||crop)event.preventDefault()}} onInteractOutside={event=>{if(busy||crop||editing)event.preventDefault()}}>
 <header><span>Информация о чате</span><button ref={close} type="button" disabled={busy} aria-label="Закрыть информацию о чате" title="Закрыть" onClick={onClose}><X size={20}/></button></header>
 <div className="conversation-info-scroll"><div className="conversation-info-identity"><span className="conversation-info-avatar" aria-hidden="true">{previewAvatar?<img src={previewAvatar} alt=""/>:previewName.trim().split(/\s+/).slice(0,2).map(word=>word[0]).join('').toLocaleUpperCase('ru')}</span><DialogPrimitive.Title asChild><h2 id="conversation-info-title">{previewName||'Название чата'}</h2></DialogPrimitive.Title><p>{participantCount(memberIds.length)}</p>{channelLabel&&<p className="conversation-info-channel">Канал: {channelLabel} · материалы только этого канала</p>}
 {editable&&!editing&&<Button ref={editTrigger} variant="ghost" size="sm" type="button" data-edit-dialog onClick={begin}><Pencil size={16}/>Редактировать чат</Button>}
 </div>
 {editing&&editable&&<section className="conversation-info-editor" data-dialog-metadata-editor aria-label="Редактировать чат">
 <div className="conversation-info-edit-avatar"><Button ref={camera} type="button" variant="outline" size="sm" disabled={busy} onClick={()=>picker.current?.click()}><Camera size={16}/>Изменить аватар</Button>{image&&<Button type="button" variant="ghost" size="sm" disabled={busy} onClick={()=>setImage('')}>Удалить аватар</Button>}<input ref={picker} hidden type="file" accept="image/png,image/jpeg,image/webp" aria-label="Аватар чата" onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file){setError('');setCrop(file)}}}/></div>
 <p className="conversation-info-edit-hint">PNG, JPEG или WebP. Квадратный аватар до 256 КБ. Изменения увидят все участники после сохранения.</p>
 <label htmlFor="dialog-metadata-name">Название чата<input ref={nameInput} id="dialog-metadata-name" value={name} maxLength={60} disabled={busy} onChange={event=>setName(event.target.value)}/></label>
 {error&&<p role="alert" className="conversation-info-edit-error">{error} Черновик не потерян.</p>}
 <div className="conversation-info-edit-actions"><Button type="button" variant="ghost" size="sm" disabled={busy} onClick={cancel}>Отмена</Button><Button type="button" size="sm" disabled={busy||!name.trim()||name.trim().length>60||(name.trim()===dialog?.name&&image===(dialog.avatar||''))} onClick={()=>void save()} data-save-dialog>{busy?'Сохранение…':'Сохранить'}</Button></div>
 </section>}
 {onSettings&&<button className="conversation-info-settings" type="button" onClick={onSettings}><Settings size={18}/>Настройки группы<ChevronRight size={16}/></button>}
 <ConversationMaterialRows messages={state.messages} channel={channel} onOpen={onMaterials}/><section className="conversation-info-members" aria-label="Участники чата"><h3>Участники <span>{memberIds.length}</span></h3><label className="conversation-info-member-search">Найти участника<input type="search" aria-label="Поиск участников по имени, логину или email" placeholder="Имя, логин или полный email" value={memberQuery} maxLength={128} onChange={event=>{setMemberQuery(event.target.value);setMemberResult(undefined)}}/></label><p className="conversation-info-search-status" role="status" aria-live="polite">{searchPending?'Поиск участника…':emailQuery&&!state.conversationMemberSearchSupported?'Поиск по email недоступен на этой версии сервера. Используйте имя или логин.':remoteResult?.error?remoteResult.error:normalizedQuery&&!shownMemberIds.length?'Участники не найдены':normalizedQuery?`Найдено: ${shownMemberIds.length}`:'Поиск только среди участников этого чата. Email не отображается.'}</p>{shownMemberIds.map(id=>{const user=id===state.me.id?state.me:state.users.find(item=>item.id===id)||remoteResult?.users.find(item=>item.id===id);return user?<button key={id} type="button" className="conversation-info-member" onClick={()=>onProfile(id)}><UserAvatar user={user} decorative decoration={user.decorations?.avatar}/><span><strong>{user.name}{id===state.me.id&&<small> · это вы</small>}</strong><small data-online={user.online||undefined}>{peerStatus(user)}</small></span><ChevronRight size={16}/></button>:<div key={id} className="conversation-info-member is-unavailable">Участник недоступен</div>})}</section></div>
 {crop&&<ImageCropDialog file={crop} kind="avatar" onClose={closeCrop} onConfirm={result=>{if(!alive.current||scopeRef.current!==scope||!live.current.editable)throw new Error('Чат или права изменились.');setImage(result.dataUrl);closeCrop()}}/>}
 </DialogPrimitive.Content></DialogPrimitive.Portal></DialogPrimitive.Root>;
}
