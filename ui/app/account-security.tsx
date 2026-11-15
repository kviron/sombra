import {useEffect,useState,type FormEvent} from 'react';
import {api,clearSession,type ChatState,type SessionDto} from '@/shared/api/backend';
import {Button} from '@/shared/ui/button';
import {Input} from '@/shared/ui/input';
import {Label} from '@/shared/ui/label';
import type {AccountSection} from './account-sidebar';

export function AccountSecurity({state,refresh,section}:{state:ChatState|null;refresh:()=>Promise<ChatState>;section:AccountSection}) {
 const [sessions,setSessions]=useState<SessionDto[]>([]),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 const [avatar,setAvatar]=useState(state?.me.avatar||''),[email,setEmail]=useState(state?.email||'');
 const [name,setName]=useState(state?.me.name||''),[bio,setBio]=useState(state?.me.bio||'');
 async function load(){setSessions(await api<SessionDto[]>('sessions'))}
 useEffect(()=>{void load().catch(e=>setError(e.message))},[]);
 useEffect(()=>{setError('');setNotice('')},[section]);
 async function run(action:()=>Promise<void>){if(busy)return;setBusy(true);setError('');setNotice('');try{await action()}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 function password(e:FormEvent<HTMLFormElement>){e.preventDefault();const data=new FormData(e.currentTarget);void run(async()=>{if(data.get('password')!==data.get('confirm'))throw new Error('Пароли не совпадают');await api('change_password',{current_password:data.get('current'),password:data.get('password')});clearSession()})}
 return <>
  <section hidden={section!=='profile'} aria-labelledby="profile-heading">
   <h2 id="profile-heading">Информация об учётной записи</h2>
   <form className="settings-form" onSubmit={e=>{e.preventDefault();void run(async()=>{await api('update_profile',{profile:{name,bio,avatar}});await refresh();setNotice('Профиль сохранён')})}}>
    <div className="settings-field"><Label htmlFor="account-avatar">Аватарка</Label><div className="avatar-editor"><span className="avatar">{avatar?<img src={avatar} alt="Предпросмотр аватарки"/>:name[0]}</span><div><Input id="account-avatar" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(!file)return;void run(async()=>{if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>5*1024*1024)throw new Error('Выберите PNG, JPEG или WebP до 5 МБ');const bitmap=await createImageBitmap(file);try{const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Не удалось прочитать изображение');const size=Math.min(bitmap.width,bitmap.height);ctx.drawImage(bitmap,(bitmap.width-size)/2,(bitmap.height-size)/2,size,size,0,0,256,256);setAvatar(canvas.toDataURL('image/png'))}finally{bitmap.close()}})}}/><p className="settings-hint">PNG, JPEG или WebP до 5 МБ</p>{avatar&&<Button type="button" variant="ghost" size="sm" disabled={busy} onClick={()=>setAvatar('')}>Удалить аватарку</Button>}</div></div></div>
    <div className="settings-field"><Label htmlFor="account-name">Имя пользователя</Label><Input id="account-name" name="name" autoComplete="nickname" value={name} onChange={e=>setName(e.target.value)} minLength={2} maxLength={32} required/></div>
    <div className="settings-field"><Label htmlFor="account-bio">О себе</Label><Input id="account-bio" value={bio} onChange={e=>setBio(e.target.value)} maxLength={190}/></div>
    <div className="settings-actions"><Button variant="secondary" size="sm" disabled={busy}>{busy?'Сохраняем…':'Сохранить профиль'}</Button></div>
   </form>
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
