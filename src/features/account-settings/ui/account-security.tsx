// Own stylesheet first: `profile-media-dialogs.css` (ниже, через импорт компонента и
// последнюю строку) намеренно переопределяет старую раскладку карточки профиля.
import './account-approved.css';
import {useEffect, useRef, useState, type FormEvent, type KeyboardEvent} from 'react';
import {type ChatState, type SessionDto, type User, type ProfileDecorationDoc} from '@/shared/types';
import {sessionService} from '@/shared/api';
import {userService} from '@/entities/user';
import {accountService} from '../model/services/account-service';
import {Button} from '@/shared/ui/button';
import {Input} from '@/shared/ui/input';
import {ImageCropDialog, type PreparedProfileImage} from '@/shared/ui/image-crop-dialog';
import {ProfileCover} from '@/shared/ui/profile-cover';
import {ProfileDecorationPicker, type MediaTarget} from './profile-decoration-picker';
import {ProfileMediaDialog} from './profile-media-dialogs';
import {UserAvatar} from '@/shared/ui/user-avatar';
import {Monitor, Pencil, Trash2} from 'lucide-react';
import {Label} from '@/shared/ui/label';
import type {AccountSection} from './account-sidebar';

import './profile-media-dialogs.css';

export function AccountSecurity({
 state,
 refresh,
 section,
 onMediaSaved
}: {
 state: ChatState | null;
 refresh: () => Promise<ChatState>;
 section: AccountSection;
 onMediaSaved: (user: User, field: MediaTarget | `decoration:${MediaTarget}`) => void;
}) {
 const [sessions, setSessions] = useState<SessionDto[]>([]),
  [error, setError] = useState(''),
  [notice, setNotice] = useState(''),
  [busy, setBusy] = useState(false);
 const [email, setEmail] = useState(state?.email || '');
 const [name, setName] = useState(state?.me.name || ''),
  [bio, setBio] = useState(state?.me.bio || '');

 const [crop, setCrop] = useState<{file: File; kind: 'avatar' | 'cover'}>();
 const cropOrigin = useRef<HTMLButtonElement | null>(null);
 useEffect(() => {
  if (crop || !cropOrigin.current) return;
  const target = cropOrigin.current;
  cropOrigin.current = null;
  const frame = requestAnimationFrame(() => {
   if (target.isConnected && !target.disabled && target.getClientRects().length) target.focus();
  });
  return () => cancelAnimationFrame(frame);
 }, [crop]);
 const [media, setMedia] = useState<MediaTarget>();
 const [effects, setEffects] = useState<MediaTarget>();
 const effectOrigin = useRef<HTMLButtonElement>(null),
  avatarPicker = useRef<HTMLInputElement>(null),
  coverPicker = useRef<HTMLInputElement>(null);
 const mounted = useRef(true),
  epoch = useRef(0),
  lock = useRef(false),
  identity = useRef(state?.me.id);
 identity.current = state?.me.id;
 const coverSupported = !!state?.me.coverSupported;
 useEffect(() => {
  mounted.current = true;
  return () => {
   mounted.current = false;
   epoch.current++;
  };
 }, []);
 useEffect(() => {
  epoch.current++;
  setCrop(undefined);
  setMedia(undefined);
  setEffects(undefined);
  setBusy(false);
  lock.current = false;
  setError('');
  setNotice('');
  setName(state?.me.name || '');
  setBio(state?.me.bio || '');
  setEmail(state?.email || '');
 }, [state?.me.id]);
 useEffect(() => {
  if (section !== 'profile') {
   setCrop(undefined);
   setMedia(undefined);
   setEffects(undefined);
  }
 }, [section]);
 async function load() {
  setSessions(await userService.sessions<SessionDto[]>());
 }
 useEffect(() => {
  void load().catch(e => setError(e.message));
 }, []);
 useEffect(() => {
  setError('');
  setNotice('');
 }, [section]);
 async function run(action: () => Promise<void>) {
  if (lock.current) return;
  const request = ++epoch.current;
  lock.current = true;
  setBusy(true);
  setError('');
  setNotice('');
  try {
   await action();
  } catch (e) {
   if (mounted.current && request === epoch.current) setError((e as Error).message);
  } finally {
   if (mounted.current && request === epoch.current) {
    lock.current = false;
    setBusy(false);
   }
  }
 }
 async function saveImage(kind: 'avatar' | 'cover', result?: PreparedProfileImage) {
  if (lock.current) throw new Error('Дождитесь сохранения');
  if (kind === 'cover' && !coverSupported) throw new Error('Для обложек требуется обновление сервера');
  const request = ++epoch.current,
   account = identity.current,
   token = sessionService.token();
  const current = () =>
   mounted.current && request === epoch.current && identity.current === account && sessionService.token() === token;
  lock.current = true;
  setBusy(true);
  setError('');
  setNotice('');
  try {
   let saved: User;
   if (kind === 'cover')
    ({user: saved} = await userService.setCover<{user: User}>({
     cover: result ? {dataUrl: result.dataUrl, crop: result.crop} : null
    }));
   else {
    const {user} = await userService.me<{user: User}>();
    if (!current() || user.id !== account) throw new Error('Учётная запись изменилась');
    await userService.updateProfile({profile: {name: user.name, bio: user.bio, avatar: result?.dataUrl ?? ''}});
    saved = {...user, avatar: result?.dataUrl ?? ''};
   }
   if (!current() || saved.id !== account) return;
   onMediaSaved(saved, kind);
   setCrop(undefined);
   setNotice(
    kind === 'cover'
     ? result
       ? 'Обложка сохранена'
       : 'Обложка удалена'
     : result
       ? 'Аватарка сохранена'
       : 'Аватарка удалена'
   );
  } catch (e) {
   if (current()) setError((e as Error).message);
   throw e;
  } finally {
   if (current()) {
    lock.current = false;
    setBusy(false);
   }
  }
 }
 async function saveEffect(target: MediaTarget, decoration: ProfileDecorationDoc | null, id?: string) {
  const account = identity.current,
   token = sessionService.token();
  const {user} = await (id
   ? accountService.applyProfileEffect(id)
   : userService.setDecoration<{user: User}>({target, decoration}));
  if (!mounted.current || user.id !== account || identity.current !== account || sessionService.token() !== token)
   return;
  onMediaSaved(user, `decoration:${target}`);
  setError('');
  setNotice(id || decoration ? 'Украшение сохранено' : 'Украшение убрано');
 }
 /**
  * The dialog keeps its own status line, so this variant returns the outcome
  * instead of writing the section-wide notice behind the modal.
  */
 async function applyMediaDecoration(target: MediaTarget, decoration: ProfileDecorationDoc | null) {
  const account = identity.current,
   token = sessionService.token();
  const {user} = await userService.setDecoration<{user: User}>({target, decoration});
  if (!mounted.current || user.id !== account || identity.current !== account || sessionService.token() !== token)
   throw new Error('Учётная запись изменилась');
  onMediaSaved(user, `decoration:${target}`);
 }
 async function saveIdentity() {
  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 32) {
   setError('Имя: 2–32 символа');
   return;
  }
  if (trimmed === state?.me.name && bio === state?.me.bio) return;
  await run(async () => {
   await userService.updateProfile({profile: {name: trimmed, bio}});
   await refresh();
   setNotice('Профиль сохранён');
  });
 }
 function identityKey(event: KeyboardEvent<HTMLInputElement>) {
  if (event.key === 'Enter') {
   event.preventDefault();
   void saveIdentity();
  } else if (event.key === 'Escape') {
   event.preventDefault();
   setName(state?.me.name || '');
   setBio(state?.me.bio || '');
   event.currentTarget.blur();
  }
 }
 function pickImage(target: MediaTarget) {
  setMedia(undefined);
  (target === 'avatar' ? avatarPicker : coverPicker).current?.click();
 }
 function openCatalog(target: MediaTarget) {
  setMedia(undefined);
  effectOrigin.current = document.querySelector<HTMLButtonElement>(
   `.profile-media [data-target="${target}"] [aria-haspopup="dialog"]`
  );
  setEffects(target);
 }
 function password(e: FormEvent<HTMLFormElement>) {
  e.preventDefault();
  const data = new FormData(e.currentTarget);
  void run(async () => {
   if (data.get('password') !== data.get('confirm')) throw new Error('Пароли не совпадают');
   await accountService.changePassword({current_password: data.get('current'), password: data.get('password')});
   sessionService.clear();
  });
 }
 return (
  <>
   {crop && (
    <ImageCropDialog
     file={crop.file}
     kind={crop.kind}
     onConfirm={result => saveImage(crop.kind, result)}
     onClose={() => {
      epoch.current++;
      lock.current = false;
      setBusy(false);
      setCrop(undefined);
     }}
    />
   )}
   <section hidden={section !== 'profile'} aria-labelledby="profile-heading">
    <h2 id="profile-heading" className="sr-only">
     Информация об учётной записи
    </h2>
    {state && (
     <div className="approved-profile-grid">
      <div className="profile-media">
       <div className="profile-media-item" data-target="cover">
        <ProfileCover user={state.me} accountId={state.me.id} className="settings-cover-preview" />
        <div className="profile-media-chips">
         <Button
          type="button"
          variant="secondary"
          size="sm"
          aria-haspopup="dialog"
          disabled={busy || state.me.bot || !coverSupported}
          onClick={() => setMedia('cover')}
         >
          <Pencil aria-hidden="true" />
          Изменить обложку
         </Button>
         {state.me.cover && (
          <Button
           type="button"
           variant="secondary"
           size="icon-lg"
           aria-label="Удалить обложку"
           title="Удалить обложку"
           disabled={busy}
           onClick={() => void saveImage('cover').catch(() => {})}
          >
           <Trash2 aria-hidden="true" />
          </Button>
         )}
        </div>
       </div>
       <div className="profile-media-item" data-target="avatar">
        <UserAvatar user={state.me} size="xl" presence={false} decorative decoration={state.me.decorations?.avatar} />
        <div className="profile-media-chips">
         <Button
          type="button"
          variant="secondary"
          size="sm"
          aria-haspopup="dialog"
          disabled={busy || state.me.bot}
          onClick={() => setMedia('avatar')}
         >
          <Pencil aria-hidden="true" />
          Изменить аватар
         </Button>
         {state.me.avatar && (
          <Button
           type="button"
           variant="secondary"
           size="icon-lg"
           aria-label="Удалить аватар"
           title="Удалить аватар"
           disabled={busy}
           onClick={() => void saveImage('avatar').catch(() => {})}
          >
           <Trash2 aria-hidden="true" />
          </Button>
         )}
        </div>
       </div>
       <div className="approved-profile-identity">
        <div className="profile-identity-field">
         <input
          id="account-name"
          className="profile-identity-input"
          autoComplete="nickname"
          aria-label="Имя пользователя"
          value={name}
          onChange={event => setName(event.target.value)}
          onKeyDown={identityKey}
          minLength={2}
          maxLength={32}
         />
         <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="profile-identity-edit"
          title="Изменить имя"
          aria-label="Изменить имя пользователя"
          onClick={() => document.querySelector<HTMLInputElement>('#account-name')?.focus()}
         >
          <Pencil aria-hidden="true" />
         </Button>
        </div>
        <div className="profile-identity-field">
         <input
          id="account-bio"
          className="profile-identity-input"
          aria-label="О себе"
          placeholder="Описание пока не добавлено."
          value={bio}
          onChange={event => setBio(event.target.value)}
          onKeyDown={identityKey}
          maxLength={190}
         />
         <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="profile-identity-edit"
          title="Изменить описание"
          aria-label="Изменить описание"
          onClick={() => document.querySelector<HTMLInputElement>('#account-bio')?.focus()}
         >
          <Pencil aria-hidden="true" />
         </Button>
        </div>
        <small>Так профиль выглядит для собеседников — имя и описание сохраняются по Enter</small>
       </div>
       <input
        hidden
        id="account-avatar"
        aria-label="Изменить аватар"
        type="file"
        ref={avatarPicker}
        accept="image/png,image/jpeg,image/webp"
        disabled={busy || state.me.bot}
        onChange={event => {
         const file = event.target.files?.[0];
         event.target.value = '';
         if (file) {
          cropOrigin.current = null;
          setCrop({file, kind: 'avatar'});
         }
        }}
       />
       <input
        hidden
        id="account-cover"
        aria-label="Изменить обложку"
        type="file"
        ref={coverPicker}
        accept="image/png,image/jpeg,image/webp,image/gif"
        disabled={busy || state.me.bot || !coverSupported}
        onChange={event => {
         const file = event.target.files?.[0];
         event.target.value = '';
         if (file) {
          cropOrigin.current = null;
          setCrop({file, kind: 'cover'});
         }
        }}
       />
      </div>
     </div>
    )}
    {state && !coverSupported && <p className="settings-hint">Обложки появятся после обновления сервера.</p>}
    {state && !(state.me.decorationSupported ?? state.decorationSupported) && (
     <p className="settings-hint">Украшения появятся после обновления сервера.</p>
    )}
    {state && media && section === 'profile' && (
     <ProfileMediaDialog
      key={`${state.me.id}:${media}`}
      user={state.me}
      target={media}
      busy={busy}
      disabled={busy || state.me.bot || (media === 'cover' && !coverSupported)}
      pickHint={
       media === 'avatar'
        ? 'PNG, JPEG или WebP · квадрат, 256 × 256 достаточно'
        : 'PNG, JPEG, WebP или GIF · 1200 × 400 покажет лучше всего'
      }
      onPickImage={() => pickImage(media)}
      onRemove={() => saveImage(media)}
      onApply={doc => applyMediaDecoration(media, doc)}
      onCatalog={() => openCatalog(media)}
      onClose={() => setMedia(undefined)}
     />
    )}
    {state && effects && section === 'profile' && (
     <ProfileDecorationPicker
      key={state.me.id + effects}
      user={state.me}
      target={effects}
      catalogSupported={!!state.effectCatalogSupported}
      draftsSupported={!!state.profileEffectDraftsSupported}
      uploadsSupported={!!state.profileEffectUploadsSupported}
      onSave={(doc, id) => saveEffect(effects, doc, id)}
      onClose={() => setEffects(undefined)}
      onRestoreFocus={() => requestAnimationFrame(() => effectOrigin.current?.focus())}
     />
    )}
    <form
     className="settings-form email-form approved-email"
     onSubmit={e => {
      e.preventDefault();
      const form = e.currentTarget;
      const data = new FormData(form);
      void run(async () => {
       await accountService.changeEmail({email, current_password: data.get('current_password')});
       await refresh();
       form.reset();
       setNotice('Почта изменена. Используйте её при следующем входе.');
      });
     }}
    >
     <h2>Электронная почта</h2>
     <div className="settings-field">
      <Label htmlFor="account-email">Почта</Label>
      <Input
       id="account-email"
       type="email"
       autoComplete="email"
       value={email}
       onChange={e => setEmail(e.target.value)}
       required
       maxLength={254}
      />
     </div>
     <div className="settings-field">
      <Label htmlFor="email-password">Текущий пароль</Label>
      <Input
       id="email-password"
       name="current_password"
       type="password"
       autoComplete="current-password"
       required
       maxLength={256}
      />
     </div>
     <div className="settings-actions">
      <Button variant="secondary" size="sm" disabled={busy || email.trim().toLowerCase() === state?.email}>
       {busy ? 'Сохраняем…' : 'Изменить почту'}
      </Button>
     </div>
    </form>
   </section>
   <section hidden={section !== 'security'} aria-labelledby="security-heading">
    <h2 id="security-heading" className="sr-only">
     Пароль и безопасность
    </h2>
    <form className="settings-form approved-password" onSubmit={password}>
     <div className="approved-password-step">
      <h3>1. Подтвердите текущий пароль</h3>
      <div className="settings-field">
       <Label htmlFor="password-current">Текущий пароль</Label>
       <Input
        id="password-current"
        name="current"
        type="password"
        autoComplete="current-password"
        required
        maxLength={256}
       />
      </div>
     </div>
     <div className="approved-password-step">
      <h3>2. Задайте новый пароль</h3>
      <div className="settings-field">
       <Label htmlFor="password-new">Новый пароль</Label>
       <Input
        id="password-new"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={8}
        maxLength={256}
        aria-describedby="password-hint"
       />
      </div>
      <div className="settings-field">
       <Label htmlFor="password-confirm">Повторите пароль</Label>
       <Input
        id="password-confirm"
        name="confirm"
        type="password"
        autoComplete="new-password"
        required
        minLength={8}
        maxLength={256}
       />
      </div>
      <p id="password-hint" className="settings-hint">
       Не менее 8 символов. После смены пароля потребуется войти заново на всех устройствах.
      </p>
     </div>{' '}
     <div className="settings-actions">
      <Button size="sm" disabled={busy}>
       {busy ? 'Сохраняем…' : 'Изменить пароль'}
      </Button>
     </div>
    </form>
   </section>
   <section hidden={section !== 'sessions'} aria-labelledby="sessions-heading">
    <h2 id="sessions-heading" className="sr-only">
     Активные сеансы
    </h2>
    <p className="settings-hint">
     С опцией «Оставаться в системе» вход сохраняется на год. Без неё — до 30 дней или 7 дней бездействия.
    </p>
    <h3 className="approved-session-count">
     Устройства <span>{sessions.length}</span>
    </h3>
    <ul className="approved-sessions">
     {sessions.map(session => (
      <li key={session.id} className="approved-session-card" data-current={session.current}>
       <Monitor size={24} aria-hidden="true" />
       <div>
        <strong>
         {session.current
          ? 'Это устройство'
          : session.device.includes('Windows')
            ? 'Windows'
            : session.device.includes('Mac')
              ? 'Mac'
              : 'Браузер / приложение'}
        </strong>
        <p title={session.device}>{session.device.slice(0, 70)}</p>
        <small>Последняя активность: {new Date(session.last_seen * 1000).toLocaleString('ru')}</small>
       </div>
       <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() =>
         void run(async () => {
          await userService.revokeSession(session.id);
          if (session.current) sessionService.clear();
          else await load();
         })
        }
       >
        Завершить
       </Button>
      </li>
     ))}
    </ul>
    <div className="approved-session-actions">
     <Button
      variant="outline"
      size="sm"
      disabled={busy}
      onClick={() =>
       void run(async () => {
        await userService.logoutAll();
        sessionService.clear();
       })
      }
     >
      Выйти на всех устройствах
     </Button>
    </div>
   </section>
   {error && <p role="alert">{error}</p>}
   {notice && <p role="status">{notice}</p>}
  </>
 );
}
