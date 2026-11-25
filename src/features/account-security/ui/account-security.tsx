// Стили раздела одной таблицей: карточка профиля и секции безопасности. Раньше
// переопределения карточки подключались из profile-media-dialogs.css — порядок сохранён.
import './account-security.css';
import {useEffect, useRef, type ComponentType, type FormEvent, type KeyboardEvent} from 'react';
import type {ChatState, ProfileDecorationDoc, ProfileEffectTarget, User} from '@/shared/types';
import {Button} from '@/shared/ui/button';
import {Input} from '@/shared/ui/input';
import {ImageCropDialog} from '@/shared/ui/image-crop-dialog';
import {ProfileCover} from '@/shared/ui/profile-cover';
import {UserAvatar} from '@/shared/ui/user-avatar';
import {Monitor, Pencil, Trash2} from 'lucide-react';
import {Label} from '@/shared/ui/label';
import {useAccountSecurity} from '../model/use-account-security';
import {deviceLabel, emailUnchanged, lastSeenLabel, sessionTitle} from '../model/account-security-rules';

/** Что компоненту нужно от диалога медиа; форма описана здесь, чтобы фича не импортировала соседнюю. */
type MediaDialogProps = {
 user: User;
 target: ProfileEffectTarget;
 busy: boolean;
 disabled: boolean;
 pickHint: string;
 onPickImage: () => void;
 onRemove: () => Promise<void>;
 onApply: (doc: ProfileDecorationDoc | null) => Promise<void>;
 onCatalog: () => void;
 onClose: () => void;
};

type DecorationPickerProps = {
 user: User;
 target: ProfileEffectTarget;
 catalogSupported?: boolean;
 draftsSupported?: boolean;
 uploadsSupported?: boolean;
 onSave: (doc: ProfileDecorationDoc | null, id?: string) => Promise<void>;
 onClose: () => void;
 onRestoreFocus: () => void;
};

/**
 * Компонент только показывает: сеансы, профиль, картинки, пароль и почта приходят
 * из модели среза, поэтому здесь остались разметка, ref-ы и обработчики форм.
 */
export function AccountSecurity({
 state,
 refresh,
 section,
 onMediaSaved,
 mediaDialog: MediaDialog,
 decorationPicker: DecorationPicker
}: {
 state: ChatState | null;
 refresh: () => Promise<ChatState>;
 /** Раздел принадлежит композиции экрана, поэтому здесь только строка. */
 section: string;
 onMediaSaved: (user: User, field: ProfileEffectTarget | `decoration:${ProfileEffectTarget}`) => void;
 mediaDialog: ComponentType<MediaDialogProps>;
 decorationPicker: ComponentType<DecorationPickerProps>;
}) {
 const {sessions, error, notice, busy, email, name, bio, crop, media, effects, coverSupported, actions} =
  useAccountSecurity({state, refresh, section, onMediaSaved});
 const cropOrigin = useRef<HTMLButtonElement | null>(null);
 const effectOrigin = useRef<HTMLButtonElement>(null),
  avatarPicker = useRef<HTMLInputElement>(null),
  coverPicker = useRef<HTMLInputElement>(null);

 // Возврат фокуса после кадрирования — забота интерфейса.
 useEffect(() => {
  if (crop || !cropOrigin.current) return;
  const target = cropOrigin.current;
  cropOrigin.current = null;
  const frame = requestAnimationFrame(() => {
   if (target.isConnected && !target.disabled && target.getClientRects().length) target.focus();
  });
  return () => cancelAnimationFrame(frame);
 }, [crop]);

 function identityKey(event: KeyboardEvent<HTMLInputElement>) {
  if (event.key === 'Enter') {
   event.preventDefault();
   actions.saveIdentity();
  } else if (event.key === 'Escape') {
   event.preventDefault();
   actions.resetFields();
   event.currentTarget.blur();
  }
 }
 function pickImage(target: ProfileEffectTarget) {
  actions.closeMedia();
  (target === 'avatar' ? avatarPicker : coverPicker).current?.click();
 }
 function openCatalog(target: ProfileEffectTarget) {
  actions.closeMedia();
  effectOrigin.current = document.querySelector<HTMLButtonElement>(
   `.profile-media [data-target="${target}"] [aria-haspopup="dialog"]`
  );
  actions.openCatalog(target);
 }
 function password(e: FormEvent<HTMLFormElement>) {
  e.preventDefault();
  const data = new FormData(e.currentTarget);
  actions.changePassword({current: data.get('current'), password: data.get('password'), confirm: data.get('confirm')});
 }
 return (
  <>
   {crop && (
    <ImageCropDialog
     file={crop.file}
     kind={crop.kind}
     onConfirm={result => actions.saveImage(crop.kind, result)}
     onClose={actions.cancelCrop}
    />
   )}
   <section hidden={section !== 'profile'} aria-labelledby="profile-heading">
    <h2 id="profile-heading" className="sr-only">
     Информация об учётной записи
    </h2>
    {state && (
     <div className="approved-profile-grid grid grid-cols-[minmax(0,1fr)] gap-0">
      <div className="profile-media">
       <div className="profile-media-item" data-target="cover">
        <ProfileCover user={state.me} accountId={state.me.id} className="settings-cover-preview" />
        <div className="profile-media-chips">
         <Button
          type="button"
          variant="secondary"
          size="sm"
          className="bg-card"
          aria-haspopup="dialog"
          disabled={busy || state.me.bot || !coverSupported}
          onClick={() => actions.openMedia('cover')}
         >
          <Pencil aria-hidden="true" />
          Изменить обложку
         </Button>
         {state.me.cover && (
          <Button
           type="button"
           variant="secondary"
           size="icon-lg"
           className="bg-card"
           aria-label="Удалить обложку"
           title="Удалить обложку"
           disabled={busy}
           onClick={() => void actions.saveImage('cover').catch(() => {})}
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
          className="bg-card"
          aria-haspopup="dialog"
          disabled={busy || state.me.bot}
          onClick={() => actions.openMedia('avatar')}
         >
          <Pencil aria-hidden="true" />
          Изменить аватар
         </Button>
         {state.me.avatar && (
          <Button
           type="button"
           variant="secondary"
           size="icon-lg"
           className="bg-card"
           aria-label="Удалить аватар"
           title="Удалить аватар"
           disabled={busy}
           onClick={() => void actions.saveImage('avatar').catch(() => {})}
          >
           <Trash2 aria-hidden="true" />
          </Button>
         )}
        </div>
       </div>
       <div className="approved-profile-identity grid gap-1 px-6 pt-14 pb-4 [overflow-wrap:anywhere]">
        <div className="profile-identity-field group flex min-w-0 items-center gap-2">
         <Input
          id="account-name"
          className="profile-identity-input text-xl leading-[1.3] font-semibold"
          autoComplete="nickname"
          aria-label="Имя пользователя"
          value={name}
          onChange={event => actions.setName(event.target.value)}
          onKeyDown={identityKey}
          minLength={2}
          maxLength={32}
         />
         <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="profile-identity-edit opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100"
          title="Изменить имя"
          aria-label="Изменить имя пользователя"
          onClick={() => document.querySelector<HTMLInputElement>('#account-name')?.focus()}
         >
          <Pencil aria-hidden="true" />
         </Button>
        </div>
        <div className="profile-identity-field group flex min-w-0 items-center gap-2">
         <Input
          id="account-bio"
          className="profile-identity-input text-[14px]"
          aria-label="О себе"
          placeholder="Описание пока не добавлено."
          value={bio}
          onChange={event => actions.setBio(event.target.value)}
          onKeyDown={identityKey}
          maxLength={190}
         />
         <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="profile-identity-edit opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100"
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
          actions.setCrop({file, kind: 'avatar'});
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
          actions.setCrop({file, kind: 'cover'});
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
     <MediaDialog
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
      onRemove={() => actions.saveImage(media)}
      onApply={doc => actions.applyDecoration(media, doc)}
      onCatalog={() => openCatalog(media)}
      onClose={actions.closeMedia}
     />
    )}
    {state && effects && section === 'profile' && (
     <DecorationPicker
      key={state.me.id + effects}
      user={state.me}
      target={effects}
      catalogSupported={!!state.effectCatalogSupported}
      draftsSupported={!!state.profileEffectDraftsSupported}
      uploadsSupported={!!state.profileEffectUploadsSupported}
      onSave={(doc, id) => actions.saveEffect(effects, doc, id)}
      onClose={actions.closeCatalog}
      onRestoreFocus={() => requestAnimationFrame(() => effectOrigin.current?.focus())}
     />
    )}
    <form
     className="settings-form email-form approved-email"
     onSubmit={e => {
      e.preventDefault();
      const form = e.currentTarget;
      const data = new FormData(form);
      void actions.changeEmail(data.get('current_password')).then(changed => {
       if (changed) form.reset();
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
       onChange={e => actions.setEmail(e.target.value)}
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
      <Button variant="secondary" size="sm" disabled={busy || emailUnchanged(email, state?.email)}>
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
     <div className="approved-password-step border-border grid min-w-0 gap-3 border-t pt-4">
      <h3 className="m-0 text-base leading-[1.5] font-semibold">1. Подтвердите текущий пароль</h3>
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
     <div className="approved-password-step border-border grid min-w-0 gap-3 border-t pt-4">
      <h3 className="m-0 text-base leading-[1.5] font-semibold">2. Задайте новый пароль</h3>
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
    <h3 className="approved-session-count m-0 mt-4 mb-3 text-base leading-[1.5] font-semibold">
     Устройства <span className="bg-muted rounded-full px-2 py-0.5 text-[13px] leading-[1.5]">{sessions.length}</span>
    </h3>
    <ul className="approved-sessions m-0 list-none p-0">
     {sessions.map(session => (
      <li
       key={session.id}
       className="approved-session-card border-border bg-card grid min-w-0 justify-items-start gap-3 rounded-[var(--radius)] border p-5 [overflow-wrap:anywhere] data-[current=true]:border-t-[var(--ring)] [&>svg]:text-[var(--ring)]"
       data-current={session.current}
      >
       <Monitor size={24} aria-hidden="true" />
       <div>
        <strong className="text-lg leading-[1.5]">{sessionTitle(session)}</strong>
        <p title={session.device}>{deviceLabel(session.device)}</p>
        <small>Последняя активность: {lastSeenLabel(session.last_seen)}</small>
       </div>
       <Button variant="outline" size="sm" disabled={busy} onClick={() => actions.revokeSession(session)}>
        Завершить
       </Button>
      </li>
     ))}
    </ul>
    <div className="approved-session-actions border-border mt-4 border-t pt-4">
     <Button variant="outline" size="sm" disabled={busy} onClick={actions.logoutAll}>
      Выйти на всех устройствах
     </Button>
    </div>
   </section>
   {error && <p role="alert">{error}</p>}
   {notice && <p role="status">{notice}</p>}
  </>
 );
}
