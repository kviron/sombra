import {useEffect,useRef,useState} from 'react';
import {Dialog} from 'radix-ui';
import {Settings,ShieldCheck,X} from 'lucide-react';
import {api,type ChatState,type Group} from '@/shared/api/backend';
import {canGroup} from '@/shared/lib/group-permissions';
import {ImageCropDialog,type PreparedProfileImage} from '@/shared/ui/image-crop-dialog';
import {GroupRolesPanel} from './group-roles-dialog';
import './group-settings-dialog.css';

export type GroupSettingsSection='general'|'roles';
export type GroupSettingsDialogProps={group:Group;state:ChatState;initialSection?:GroupSettingsSection;onClose:()=>void;refresh:()=>Promise<ChatState>;onError?:(message:string)=>void;onManageStickers:(groupId:string)=>void};
export function GroupSettingsDialog({group,state,initialSection='general',onClose,refresh,onError,onManageStickers}:GroupSettingsDialogProps){
 const [section,setSection]=useState(initialSection);
 const live=state.groups.find(item=>item.id===group.id);
 const current=live??group;
 const member=!!live&&current.members.includes(state.me.id);
 const rename=member&&canGroup(current,state.me.id,'group.rename');
 const avatarAllowed=member&&canGroup(current,state.me.id,'group.avatar');
 const [nameDraft,setNameDraft]=useState<string>();
 const [avatarDraft,setAvatarDraft]=useState<string>();
 const [cropFile,setCropFile]=useState<File>();
 const cropOrigin=useRef<HTMLInputElement|null>(null);
 useEffect(()=>{if(cropFile||!cropOrigin.current)return;const target=cropOrigin.current;cropOrigin.current=null;const frame=requestAnimationFrame(()=>{if(target.isConnected&&!target.disabled&&target.getClientRects().length)target.focus()});return()=>cancelAnimationFrame(frame)},[cropFile]);
 const scope=`${state.me.id}:${group.id}`,scopeRef=useRef(scope);scopeRef.current=scope;
 useEffect(()=>{setCropFile(undefined);setAvatarDraft(undefined);setNameDraft(undefined)},[scope]);
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const name=nameDraft??current.name,avatar=avatarDraft??current.avatar??'';
 const nameChanged=name.trim()!==current.name,avatarChanged=avatar!==(current.avatar??'');
 const lock=useRef(false),mounted=useRef(true),rolesBusy=useRef(false);
 const [rolePending,setRolePending]=useState(false);
 const latest=useRef({current,member,rename,avatarAllowed});latest.current={current,member,rename,avatarAllowed};
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[]);
 async function run(action:()=>Promise<unknown>,after?:()=>void){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await action();await refresh();if(mounted.current)after?.()}catch(cause){const message=cause instanceof Error?cause.message:String(cause);if(mounted.current)setError(message);onError?.(message);try{await refresh()}catch{/* Preserve original error and draft. */}}finally{lock.current=false;if(mounted.current)setBusy(false)}}
 function save(){const fresh=latest.current;const changedName=name.trim()!==fresh.current.name,changedAvatar=avatar!==(fresh.current.avatar??'');if(!fresh.member||(changedName&&!fresh.rename)||(changedAvatar&&!fresh.avatarAllowed)){setError('Права изменились. Проверьте доступные действия.');return}if(!name.trim()||name.trim().length>60||(!changedName&&!changedAvatar))return;void run(()=>api('update_group',{group:fresh.current.id,...(changedName?{name:name.trim()}:{}),...(changedAvatar?{avatar}:{})}),()=>{setNameDraft(undefined);setAvatarDraft(undefined)})}
 function upload(file:File){if(lock.current||!latest.current.avatarAllowed)return;setError('');setCropFile(file)}
 function applyAvatar(result:PreparedProfileImage){if(!mounted.current||scopeRef.current!==scope||!latest.current.member||!latest.current.avatarAllowed)throw new Error('Права изменились. Изменение аватара недоступно.');setAvatarDraft(result.dataUrl);setCropFile(undefined)}
 return <Dialog.Root open onOpenChange={open=>{if(!open&&!lock.current&&!rolesBusy.current)onClose()}}><Dialog.Portal><Dialog.Overlay className="group-roles-overlay"/><Dialog.Content className="group-roles-dialog group-settings-dialog" onEscapeKeyDown={event=>{if(lock.current||rolesBusy.current)event.preventDefault()}}>
  {cropFile&&<ImageCropDialog file={cropFile} kind="avatar" onConfirm={applyAvatar} onClose={()=>setCropFile(undefined)}/>}
  <aside className="gs-sidebar"><div className="gs-group-name">{current.name}</div><nav aria-label="Настройки группы"><button aria-current={section==='general'?'page':undefined} disabled={rolePending} onClick={()=>setSection('general')}><Settings size={18}/>Общее</button><button aria-current={section==='roles'?'page':undefined} disabled={busy} onClick={()=>setSection('roles')}><ShieldCheck size={18}/>Роли и разрешения</button></nav></aside>
  <div className="gs-main"><header className="gs-header"><div><Dialog.Title>{section==='general'?'Общее':'Роли и разрешения'}</Dialog.Title><Dialog.Description>Настройки группы · {current.name}</Dialog.Description></div><Dialog.Close asChild><button className="gr-icon" disabled={busy||rolePending} aria-label="Закрыть настройки группы"><X size={20}/></button></Dialog.Close></header>
  {section==='roles'?<GroupRolesPanel group={current} state={state} onClose={onClose} refresh={refresh} onError={onError} onBusyChange={value=>{rolesBusy.current=value;setRolePending(value)}}/>:<><div className="gs-content">
   {!member&&<p className="gr-error" role="alert">Группа недоступна. Изменения запрещены.</p>}
   <section className="gs-avatar-field"><span className="gs-avatar" aria-hidden="true">{avatar?<img src={avatar} alt=""/>:name.slice(0,2)}</span><div><label htmlFor="gs-avatar">Аватар группы</label><input id="gs-avatar" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy||!avatarAllowed} aria-describedby="gs-avatar-hint" onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file){cropOrigin.current=event.currentTarget;upload(file)}}}/><p id="gs-avatar-hint" className="gr-note">PNG, JPEG или WebP до 20 МБ / 32 Мп. PNG 256 × 256, до 256 КБ.</p>{avatar&&avatarAllowed&&<button disabled={busy} onClick={()=>setAvatarDraft('')}>Удалить аватар</button>}</div></section>
   <label className="gs-name" htmlFor="gs-name">Название группы<input id="gs-name" value={name} maxLength={60} disabled={busy||!rename} onChange={event=>setNameDraft(event.target.value)}/></label>
   {!rename&&!avatarAllowed&&<p className="gr-note">Только просмотр. Изменение названия и аватара доступно по отдельным разрешениям.</p>}

   {member&&canGroup(current,state.me.id,'stickers.manage')&&<button disabled={busy} onClick={()=>onManageStickers(current.id)}>Стикеры группы</button>}
  </div><footer className="gs-footer">{error&&<p role="alert" className="gr-error">{error}</p>}<div><span className="gr-note">{busy?'Сохранение…':nameChanged||avatarChanged?'Есть несохранённые изменения':''}</span>{(rename||avatarAllowed)&&<button className="gr-primary" disabled={busy||!name.trim()||(!nameChanged&&!avatarChanged)||(nameChanged&&!rename)||(avatarChanged&&!avatarAllowed)} onClick={save}>Сохранить</button>}</div></footer></>}
  </div></Dialog.Content></Dialog.Portal></Dialog.Root>;
}
