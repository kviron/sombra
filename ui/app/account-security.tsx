import {useEffect,useRef,useState,type FormEvent} from 'react';
import {api,clearSession,session,type ChatState,type SessionDto,type User} from '@/shared/api/backend';
import {Button} from '@/shared/ui/button';
import {Input} from '@/shared/ui/input';
import {ImageCropDialog,type PreparedProfileImage} from '@/shared/ui/image-crop-dialog';
import {ProfileCover} from '@/shared/ui/profile-cover';
import {ProfileDecorationPicker} from './profile-decoration-picker';
import {Label} from '@/shared/ui/label';
import type {AccountSection} from './account-sidebar';

export function AccountSecurity({state,refresh,section}:{state:ChatState|null;refresh:()=>Promise<ChatState>;section:AccountSection}) {
 const [sessions,setSessions]=useState<SessionDto[]>([]),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 const [email,setEmail]=useState(state?.email||'');
 const [name,setName]=useState(state?.me.name||''),[bio,setBio]=useState(state?.me.bio||'');
 const avatar=state?.me.avatar;
 const [crop,setCrop]=useState<{file:File;kind:'avatar'|'cover'}>();
 const cropOrigin=useRef<HTMLInputElement|null>(null);
 useEffect(()=>{if(crop||!cropOrigin.current)return;const target=cropOrigin.current;cropOrigin.current=null;const frame=requestAnimationFrame(()=>{if(target.isConnected&&!target.disabled&&target.getClientRects().length)target.focus()});return()=>cancelAnimationFrame(frame)},[crop]);
 const mounted=useRef(true),epoch=useRef(0),lock=useRef(false),identity=useRef(state?.me.id);identity.current=state?.me.id;
 const coverSupported=!!state?.me.coverSupported;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;epoch.current++}},[]);
 useEffect(()=>{epoch.current++;setCrop(undefined);setBusy(false);lock.current=false;setError('');setNotice('');setName(state?.me.name||'');setBio(state?.me.bio||'');setEmail(state?.email||'')},[state?.me.id]);
 useEffect(()=>{if(section!=='profile')setCrop(undefined)},[section]);
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
   if(kind==='cover')await api('set_profile_cover',{cover:result?{dataUrl:result.dataUrl,crop:result.crop}:null});
   else {const {user}=await api<{user:User}>('me');if(!current()||user.id!==account)throw new Error('Учётная запись изменилась');await api('update_profile',{profile:{name:user.name,bio:user.bio,avatar:result?.dataUrl??''}})}
   if(!current())return;await refresh();if(!current())return;
   setCrop(undefined);setNotice(kind==='cover'?(result?'Обложка сохранена':'Обложка удалена'):(result?'Аватарка сохранена':'Аватарка удалена'));
  }catch(e){if(current())setError((e as Error).message);throw e}finally{if(current()){lock.current=false;setBusy(false)}}
 }
 function password(e:FormEvent<HTMLFormElement>){e.preventDefault();const data=new FormData(e.currentTarget);void run(async()=>{if(data.get('password')!==data.get('confirm'))throw new Error('Пароли не совпадают');await api('change_password',{current_password:data.get('current'),password:data.get('password')});clearSession()})}
 return <>
   {crop&&<ImageCropDialog file={crop.file} kind={crop.kind} onConfirm={result=>saveImage(crop.kind,result)} onClose={()=>{epoch.current++;lock.current=false;setBusy(false);setCrop(undefined)}}/>}
  <section hidden={section!=='profile'} aria-labelledby="profile-heading">
   <h2 id="profile-heading">Информация об учётной записи</h2>
   <form className="settings-form" onSubmit={e=>{e.preventDefault();void run(async()=>{await api('update_profile',{profile:{name,bio}});await refresh();setNotice('Профиль сохранён')})}}>
    <div className="settings-field">
     <Label htmlFor="account-avatar">Аватарка</Label>
     <div className="avatar-editor">
      <span className="avatar">{avatar?<img src={avatar} alt="Аватарка профиля"/>:name[0]}</span>
      <div>
       <Input id="account-avatar" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy||!state}
        onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file){cropOrigin.current=e.currentTarget;setCrop({file,kind:'avatar'})}}}/>
       <p className="settings-hint">PNG, JPEG или WebP до 20 МБ / 32 Мп. Сохранение: PNG 256 × 256, до 256 КБ.</p>
       {avatar&&<Button type="button" variant="ghost" size="sm" disabled={busy} onClick={()=>void saveImage('avatar').catch(()=>{})}>Удалить аватарку</Button>}
      </div>
     </div>
    </div>
    <div className="settings-field">
     <Label htmlFor="account-cover">Обложка профиля</Label>
     {state&&section==='profile'&&<ProfileCover user={state.me} accountId={state.me.id} className="settings-cover-preview"/>}
     <Input id="account-cover" type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={busy||!state||!coverSupported||!!state.me.bot} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file){cropOrigin.current=e.currentTarget;setCrop({file,kind:'cover'})}}}/>
     <p className="settings-hint">1200 × 400 (3:1). PNG, JPEG или WebP до 20 МБ / 32 Мп; GIF до 2 МБ с сохранением анимации. Сохранённая обложка — до 2 МБ.</p>
     {!coverSupported&&<p className="settings-hint">Обложки появятся после обновления сервера. Аватарки доступны уже сейчас.</p>}
     {state?.me.cover&&<Button type="button" variant="ghost" size="sm" disabled={busy||!coverSupported||!!state.me.bot} onClick={()=>void saveImage('cover').catch(()=>{})}>Удалить обложку</Button>}
    </div>
    <div className="settings-field"><Label htmlFor="account-name">Имя пользователя</Label><Input id="account-name" name="name" autoComplete="nickname" value={name} onChange={e=>setName(e.target.value)} minLength={2} maxLength={32} required/></div>
    <div className="settings-field"><Label htmlFor="account-bio">О себе</Label><Input id="account-bio" value={bio} onChange={e=>setBio(e.target.value)} maxLength={190}/></div>
    <div className="settings-actions"><Button variant="secondary" size="sm" disabled={busy}>{busy?'Сохраняем…':'Сохранить профиль'}</Button></div>
   </form>
   <ProfileDecorationPicker state={state} refresh={refresh}/>
   <form className="settings-form email-form" onSubmit={e=>{e.preventDefault();const form=e.currentTarget;const data=new FormData(form);void run(async()=>{await api('change_email',{email,current_password:data.get('current_password')});await refresh();form.reset();setNotice('Почта изменена. Используйте её при следующем входе.')})}}>
    <h2>Электронная почта</h2>
    <div className="settings-field"><Label htmlFor="account-email">Почта</Label><Input id="account-email" type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} required maxLength={254}/></div>
    <div className="settings-field"><Label htmlFor="email-password">Текущий пароль</Label><Input id="email-password" name="current_password" type="password" autoComplete="current-password" required maxLength={256}/></div>
    <div className="settings-actions"><Button variant="secondary" size="sm" disabled={busy||email.trim().toLowerCase()===state?.email}>{busy?'Сохраняем…':'Изменить почту'}</Button></div>
   </form>
  </section>
  <section hidden={section!=='security'} aria-labelledby="security-heading">
   <h2 id="security-heading">Пароль и безопасность</h2>
   <form className="settings-form" onSubmit={password}>
    <div className="settings-field"><Label htmlFor="password-current">Текущий пароль</Label><Input id="password-current" name="current" type="password" autoComplete="current-password" required maxLength={256}/></div>
    <div className="settings-field"><Label htmlFor="password-new">Новый пароль</Label><Input id="password-new" name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={256} aria-describedby="password-hint"/></div>
    <div className="settings-field"><Label htmlFor="password-confirm">Повторите пароль</Label><Input id="password-confirm" name="confirm" type="password" autoComplete="new-password" required minLength={8} maxLength={256}/></div>
    <p id="password-hint" className="settings-hint">Не менее 8 символов. После смены пароля потребуется войти заново на всех устройствах.</p>
    <div className="settings-actions"><Button variant="secondary" size="sm" disabled={busy}>{busy?'Сохраняем…':'Изменить пароль'}</Button></div>
   </form>
  </section>
  <section hidden={section!=='sessions'} aria-labelledby="sessions-heading">
   <h2 id="sessions-heading">Активные сеансы</h2>
   <p className="settings-hint">С опцией «Оставаться в системе» вход сохраняется на год. Без неё — до 30 дней или 7 дней бездействия.</p>
   {sessions.map(session=><div key={session.id} className="session-row"><div><strong>{session.current?'Это устройство':session.device.includes('Windows')?'Windows':session.device.includes('Mac')?'Mac':'Браузер / приложение'}</strong><p title={session.device}>{session.device.slice(0,70)}</p><small>Последняя активность: {new Date(session.last_seen*1000).toLocaleString('ru')}</small></div><Button variant="outline" size="sm" disabled={busy} onClick={()=>void run(async()=>{await api('revoke_session',{session_id:session.id});if(session.current)clearSession();else await load()})}>Завершить</Button></div>)}
   <Button variant="outline" size="sm" disabled={busy} onClick={()=>void run(async()=>{await api('logout_all');clearSession()})}>Выйти на всех устройствах</Button>
  </section>
  {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
 </>;
}
