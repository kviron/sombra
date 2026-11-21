import {useEffect,useRef,useState,type FormEvent} from 'react';
import {api,applyProfileEffect,clearSession,session,type ChatState,type SessionDto,type User,type ProfileDecorationDoc} from '@/shared/api/backend';
import {Button} from '@/shared/ui/button';
import {Input} from '@/shared/ui/input';
import {ImageCropDialog,type PreparedProfileImage} from '@/shared/ui/image-crop-dialog';
import {ProfileCover} from '@/shared/ui/profile-cover';
import {ProfileDecorationPicker,type MediaTarget} from './profile-decoration-picker';
import {UserAvatar} from '@/shared/ui/user-avatar';
import {Monitor,Pencil,Sparkles,Trash2} from 'lucide-react';
import {Label} from '@/shared/ui/label';
import type {AccountSection} from './account-sidebar';

import './account-approved.css';

export function AccountSecurity({state,refresh,section,onMediaSaved}:{state:ChatState|null;refresh:()=>Promise<ChatState>;section:AccountSection;onMediaSaved:(user:User,field:MediaTarget|`decoration:${MediaTarget}`)=>void}) {
 const [sessions,setSessions]=useState<SessionDto[]>([]),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 const [email,setEmail]=useState(state?.email||'');
 const [name,setName]=useState(state?.me.name||''),[bio,setBio]=useState(state?.me.bio||'');

 const [crop,setCrop]=useState<{file:File;kind:'avatar'|'cover'}>();
 const cropOrigin=useRef<HTMLButtonElement|null>(null);
 useEffect(()=>{if(crop||!cropOrigin.current)return;const target=cropOrigin.current;cropOrigin.current=null;const frame=requestAnimationFrame(()=>{if(target.isConnected&&!target.disabled&&target.getClientRects().length)target.focus()});return()=>cancelAnimationFrame(frame)},[crop]);
 const [effects,setEffects]=useState<MediaTarget>();
 const effectOrigin=useRef<HTMLButtonElement>(null),avatarPicker=useRef<HTMLInputElement>(null),coverPicker=useRef<HTMLInputElement>(null);
 const mounted=useRef(true),epoch=useRef(0),lock=useRef(false),identity=useRef(state?.me.id);identity.current=state?.me.id;
 const coverSupported=!!state?.me.coverSupported;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;epoch.current++}},[]);
 useEffect(()=>{epoch.current++;setCrop(undefined);setEffects(undefined);setBusy(false);lock.current=false;setError('');setNotice('');setName(state?.me.name||'');setBio(state?.me.bio||'');setEmail(state?.email||'')},[state?.me.id]);
 useEffect(()=>{if(section!=='profile'){setCrop(undefined);setEffects(undefined)}},[section]);
 async function load(){setSessions(await api<SessionDto[]>('sessions'))}
 useEffect(()=>{void load().catch(e=>setError(e.message))},[]);
 useEffect(()=>{setError('');setNotice('')},[section]);
 async function run(action:()=>Promise<void>){if(lock.current)return;const request=++epoch.current;lock.current=true;setBusy(true);setError('');setNotice('');try{await action()}catch(e){if(mounted.current&&request===epoch.current)setError((e as Error).message)}finally{if(mounted.current&&request===epoch.current){lock.current=false;setBusy(false)}}}
 async function saveImage(kind:'avatar'|'cover',result?:PreparedProfileImage){
  if(lock.current)throw new Error('Дождитесь сохранения');
  if(kind==='cover'&&!coverSupported)throw new Error('Для обложек требуется обновление сервера');
  const request=++epoch.current,account=identity.current,token=session();
  const current=()=>mounted.current&&request===epoch.current&&identity.current===account&&session()===token;
  lock.current=true;setBusy(true);setError('');setNotice('');
  try{
   let saved:User;
   if(kind==='cover')({user:saved}=await api<{user:User}>('set_profile_cover',{cover:result?{dataUrl:result.dataUrl,crop:result.crop}:null}));
   else {const {user}=await api<{user:User}>('me');if(!current()||user.id!==account)throw new Error('Учётная запись изменилась');await api('update_profile',{profile:{name:user.name,bio:user.bio,avatar:result?.dataUrl??''}});saved={...user,avatar:result?.dataUrl??''}}
   if(!current()||saved.id!==account)return;
   onMediaSaved(saved,kind);
   setCrop(undefined);setNotice(kind==='cover'?(result?'Обложка сохранена':'Обложка удалена'):(result?'Аватарка сохранена':'Аватарка удалена'));
  }catch(e){if(current())setError((e as Error).message);throw e}finally{if(current()){lock.current=false;setBusy(false)}}
 }
 async function saveEffect(target:MediaTarget,decoration:ProfileDecorationDoc|null,id?:string){
  const account=identity.current,token=session();
  const {user}=await (id?applyProfileEffect(id):api<{user:User}>('set_profile_decoration',{target,decoration}));
  if(!mounted.current||user.id!==account||identity.current!==account||session()!==token)return;
  onMediaSaved(user,`decoration:${target}`);
  setError('');setNotice(id||decoration?'Украшение сохранено':'Украшение убрано');
 }
 function password(e:FormEvent<HTMLFormElement>){e.preventDefault();const data=new FormData(e.currentTarget);void run(async()=>{if(data.get('password')!==data.get('confirm'))throw new Error('Пароли не совпадают');await api('change_password',{current_password:data.get('current'),password:data.get('password')});clearSession()})}
 return <>
   {crop&&<ImageCropDialog file={crop.file} kind={crop.kind} onConfirm={result=>saveImage(crop.kind,result)} onClose={()=>{epoch.current++;lock.current=false;setBusy(false);setCrop(undefined)}}/>}
  <section hidden={section!=='profile'} aria-labelledby="profile-heading">
   <h2 id="profile-heading" className="sr-only">Информация об учётной записи</h2>
   <form className="settings-form" onSubmit={e=>{e.preventDefault();void run(async()=>{await api('update_profile',{profile:{name,bio}});await refresh();setNotice('Профиль сохранён')})}}>     <div className="approved-profile-grid"><div className="approved-profile-fields"><h3>Основная информация</h3><div className="settings-field"><Label htmlFor="account-name">Имя пользователя</Label><Input id="account-name" name="name" autoComplete="nickname" value={name} onChange={e=>setName(e.target.value)} minLength={2} maxLength={32} required/></div><div className="settings-field"><Label htmlFor="account-bio">О себе</Label><Input id="account-bio" value={bio} onChange={e=>setBio(e.target.value)} maxLength={190}/></div><div className="settings-actions"><Button size="sm" disabled={busy}>{busy?'Сохраняем…':'Сохранить профиль'}</Button></div></div>{state&&section==='profile'&&<div className="profile-media">
      {(['avatar','cover'] as const).map(target=>{
       const avatar=target==='avatar',me=state.me;
       const imageSupported=!me.bot&&(avatar||coverSupported);
       const effectSupported=!me.bot&&(me.decorationSupported??state.decorationSupported??false);
       const editLabel=avatar?'Изменить аватар':'Изменить обложку';
       return <div key={target} className="profile-media-item" data-target={target}>
        <div className="profile-media-preview">
         {avatar?<UserAvatar user={me} size="xl" presence={false} decorative decoration={me.decorations?.avatar}/>:<ProfileCover user={me} accountId={me.id} className="settings-cover-preview"/>}
         <div className="profile-media-controls">
          {imageSupported&&<button type="button" title={editLabel} aria-label={editLabel} disabled={busy} onClick={()=> (avatar?avatarPicker:coverPicker).current?.click()}><Pencil size={17}/></button>}
          {effectSupported&&<button type="button" title={avatar?'Рамка аватара':'Эффект обложки'} aria-label={avatar?'Рамка аватара':'Эффект обложки'} aria-haspopup="dialog" disabled={busy} onClick={event=>{effectOrigin.current=event.currentTarget;setEffects(target)}}><Sparkles size={17}/></button>}
          {imageSupported&&(avatar?me.avatar:me.cover)&&<button type="button" title={avatar?'Удалить аватар':'Удалить обложку'} aria-label={avatar?'Удалить аватар':'Удалить обложку'} disabled={busy} onClick={event=>{const edit=event.currentTarget.parentElement?.querySelector('button');void saveImage(target).then(()=>requestAnimationFrame(()=>edit?.focus())).catch(()=>{})}}><Trash2 size={17}/></button>}
         </div>
        </div>
        <span className="profile-media-label">{avatar?'Аватар':'Обложка'}</span>
        <input hidden id={avatar?'account-avatar':'account-cover'} aria-label={editLabel} type="file" ref={avatar?avatarPicker:coverPicker} accept={`image/png,image/jpeg,image/webp${avatar?'':',image/gif'}`} disabled={busy||!imageSupported}
         onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file){cropOrigin.current=event.currentTarget.parentElement?.querySelector('button')??null;setCrop({file,kind:target})}}}/>
       </div>;
      })}
<div className="approved-profile-identity"><strong>{name.trim()||'Имя пользователя'}</strong><p>{bio||'Описание пока не добавлено.'}</p><small>Так профиль выглядит для собеседников</small></div><div className="approved-profile-media-actions">
        <Button type="button" variant="outline" disabled={busy||state.me.bot} onClick={()=>avatarPicker.current?.click()}>Изменить аватар</Button>
        <Button type="button" variant="outline" disabled={busy||state.me.bot||!coverSupported} onClick={()=>coverPicker.current?.click()}>Изменить обложку</Button>
       </div></div>}</div>
     {state&&!coverSupported&&<p className="settings-hint">Обложки появятся после обновления сервера.</p>}
     {state&&!(state.me.decorationSupported??state.decorationSupported)&&<p className="settings-hint">Украшения появятся после обновления сервера.</p>}
   </form>
   {state&&effects&&section==='profile'&&<ProfileDecorationPicker key={state.me.id+effects} user={state.me} target={effects} catalogSupported={!!state.effectCatalogSupported} draftsSupported={!!state.profileEffectDraftsSupported} uploadsSupported={!!state.profileEffectUploadsSupported} onSave={(doc,id)=>saveEffect(effects,doc,id)} onClose={()=>setEffects(undefined)} onRestoreFocus={()=>requestAnimationFrame(()=>effectOrigin.current?.focus())}/>}
   <form className="settings-form email-form approved-email" onSubmit={e=>{e.preventDefault();const form=e.currentTarget;const data=new FormData(form);void run(async()=>{await api('change_email',{email,current_password:data.get('current_password')});await refresh();form.reset();setNotice('Почта изменена. Используйте её при следующем входе.')})}}>
    <h2>Электронная почта</h2>
    <div className="settings-field"><Label htmlFor="account-email">Почта</Label><Input id="account-email" type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} required maxLength={254}/></div>
    <div className="settings-field"><Label htmlFor="email-password">Текущий пароль</Label><Input id="email-password" name="current_password" type="password" autoComplete="current-password" required maxLength={256}/></div>
    <div className="settings-actions"><Button variant="secondary" size="sm" disabled={busy||email.trim().toLowerCase()===state?.email}>{busy?'Сохраняем…':'Изменить почту'}</Button></div>
   </form>
  </section>
  <section hidden={section!=='security'} aria-labelledby="security-heading">
   <h2 id="security-heading" className="sr-only">Пароль и безопасность</h2>
   <form className="settings-form approved-password" onSubmit={password}><div className="approved-password-step"><h3>1. Подтвердите текущий пароль</h3>
    <div className="settings-field"><Label htmlFor="password-current">Текущий пароль</Label><Input id="password-current" name="current" type="password" autoComplete="current-password" required maxLength={256}/></div>
</div><div className="approved-password-step"><h3>2. Задайте новый пароль</h3>
    <div className="settings-field"><Label htmlFor="password-new">Новый пароль</Label><Input id="password-new" name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={256} aria-describedby="password-hint"/></div>
    <div className="settings-field"><Label htmlFor="password-confirm">Повторите пароль</Label><Input id="password-confirm" name="confirm" type="password" autoComplete="new-password" required minLength={8} maxLength={256}/></div>
    <p id="password-hint" className="settings-hint">Не менее 8 символов. После смены пароля потребуется войти заново на всех устройствах.</p>
</div>    <div className="settings-actions"><Button size="sm" disabled={busy}>{busy?'Сохраняем…':'Изменить пароль'}</Button></div>
   </form>
  </section>
  <section hidden={section!=='sessions'} aria-labelledby="sessions-heading">
   <h2 id="sessions-heading" className="sr-only">Активные сеансы</h2>
   <p className="settings-hint">С опцией «Оставаться в системе» вход сохраняется на год. Без неё — до 30 дней или 7 дней бездействия.</p>
   <h3 className="approved-session-count">Устройства <span>{sessions.length}</span></h3><ul className="approved-sessions">{sessions.map(session=><li key={session.id} className="approved-session-card" data-current={session.current}><Monitor size={24} aria-hidden="true"/><div><strong>{session.current?'Это устройство':session.device.includes('Windows')?'Windows':session.device.includes('Mac')?'Mac':'Браузер / приложение'}</strong><p title={session.device}>{session.device.slice(0,70)}</p><small>Последняя активность: {new Date(session.last_seen*1000).toLocaleString('ru')}</small></div><Button variant="outline" size="sm" disabled={busy} onClick={()=>void run(async()=>{await api('revoke_session',{session_id:session.id});if(session.current)clearSession();else await load()})}>Завершить</Button></li>)}</ul><div className="approved-session-actions">
   <Button variant="outline" size="sm" disabled={busy} onClick={()=>void run(async()=>{await api('logout_all');clearSession()})}>Выйти на всех устройствах</Button></div>
  </section>
  {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
 </>;
}
