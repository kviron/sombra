import {useEffect, useRef, useState} from 'react';
import {Dialog} from 'radix-ui';
import {Sparkles, Upload, X} from 'lucide-react';
import type {ProfileDecorationDoc, User} from '@/shared/types';
import {DECORATION_PRESETS, normalizeDecoration} from '@/shared/ui/avatar-fx';
import {UserAvatar} from '@/shared/ui/user-avatar';
import {ProfileCover} from '@/shared/ui/profile-cover';
import {Button} from '@/shared/ui/button';
import type {MediaTarget} from './profile-decoration-picker';
import './profile-media-dialogs.css';

type Option = {key: string; title: string; doc: ProfileDecorationDoc | null};

const OPTIONS: Record<MediaTarget, Option[]> = {
 avatar: [
  {key: 'none', title: 'Без рамки', doc: null},
  {
   key: 'ember-crown',
   title: 'Пламенный обод',
   doc: DECORATION_PRESETS['ember-crown'].decoration as ProfileDecorationDoc
  },
  {key: 'slime-pet', title: 'Слайм-питомец', doc: DECORATION_PRESETS['slime-pet'].decoration as ProfileDecorationDoc}
 ],
 cover: [
  {key: 'none', title: 'Без анимации', doc: null},
  {key: 'aurora-cover', title: 'Сияние', doc: DECORATION_PRESETS['aurora-cover'].decoration as ProfileDecorationDoc},
  {key: 'runner-cover', title: 'Бегун', doc: DECORATION_PRESETS['runner-cover'].decoration as ProfileDecorationDoc}
 ]
};

const same = (left: ProfileDecorationDoc | null, right: ProfileDecorationDoc | null, target: MediaTarget) =>
 JSON.stringify(normalizeDecoration(left, {target}).value) ===
 JSON.stringify(normalizeDecoration(right, {target}).value);

/** Compact chooser for one media slot: upload the picture, pick a frame or an animated cover. */
export function ProfileMediaDialog({
 user,
 target,
 busy,
 disabled,
 pickHint,
 onPickImage,
 onRemove,
 onApply,
 onCatalog,
 onClose
}: {
 user: User;
 target: MediaTarget;
 busy: boolean;
 disabled: boolean;
 pickHint: string;
 onPickImage: () => void;
 onRemove: () => Promise<void>;
 onApply: (doc: ProfileDecorationDoc | null) => Promise<void>;
 onCatalog: () => void;
 onClose: () => void;
}) {
 const heading = useRef<HTMLHeadingElement>(null),
  origin = useRef<HTMLElement | null>(null);
 const [saving, setSaving] = useState(false),
  [error, setError] = useState(''),
  [notice, setNotice] = useState('');
 useEffect(() => {
  origin.current = document.activeElement as HTMLElement | null;
 }, []);
 const frame = user.decorations?.[target] ?? null;
 const hasImage = target === 'avatar' ? !!user.avatar : !!user.cover;
 const title = target === 'avatar' ? 'Аватар профиля' : 'Обложка профиля';
 const description =
  target === 'avatar'
   ? 'Квадратная картинка и рамка вокруг неё.'
   : 'Широкая картинка за аватаром и анимация поверх неё.';
 async function apply(doc: ProfileDecorationDoc | null) {
  if (saving || busy) return;
  setSaving(true);
  setError('');
  setNotice('');
  try {
   await onApply(doc);
   setNotice(
    target === 'avatar' ? (doc ? 'Рамка обновлена' : 'Рамка убрана') : doc ? 'Анимация обновлена' : 'Анимация убрана'
   );
  } catch (reason) {
   setError(reason instanceof Error ? reason.message : 'Не удалось сохранить оформление');
  } finally {
   setSaving(false);
  }
 }
 async function remove() {
  if (saving || busy) return;
  setSaving(true);
  setError('');
  setNotice('');
  try {
   await onRemove();
   setNotice(target === 'avatar' ? 'Аватар удалён' : 'Обложка удалена');
  } catch (reason) {
   setError(reason instanceof Error ? reason.message : 'Не удалось удалить изображение');
  } finally {
   setSaving(false);
  }
 }
 return (
  <Dialog.Root
   open
   onOpenChange={open => {
    if (!open && !saving && !busy) onClose();
   }}
  >
   <Dialog.Portal>
    <Dialog.Overlay className="profile-media-overlay" />
    <Dialog.Content
     className="profile-media-dialog dark"
     data-target={target}
     aria-busy={saving || busy}
     onOpenAutoFocus={event => {
      event.preventDefault();
      heading.current?.focus();
     }}
     onCloseAutoFocus={event => {
      event.preventDefault();
      origin.current?.focus();
     }}
     onEscapeKeyDown={event => {
      if (saving || busy) event.preventDefault();
     }}
     onInteractOutside={event => {
      if (saving || busy) event.preventDefault();
     }}
    >
     <header>
      <div>
       <Dialog.Title ref={heading} tabIndex={-1}>
        {title}
       </Dialog.Title>
       <Dialog.Description>{description}</Dialog.Description>
      </div>
      <Dialog.Close asChild>
       <Button type="button" variant="ghost" size="icon" disabled={saving || busy} aria-label="Закрыть окно">
        <X />
       </Button>
      </Dialog.Close>
     </header>
     <section className="profile-media-section">
      <h3>Изображение</h3>
      <div className="profile-media-picture" data-kind={target}>
       {target === 'avatar' ? (
        <UserAvatar user={user} size="xl" presence={false} decorative effectAsset={null} decoration={frame} />
       ) : (
        <ProfileCover
         user={user}
         accountId={user.id}
         className="profile-media-cover"
         decoration={frame}
         effectAsset={null}
        />
       )}
      </div>
      <div className="profile-media-picture-actions">
       <Button type="button" variant="outline" size="sm" disabled={disabled || saving || busy} onClick={onPickImage}>
        <Upload />
        Загрузить
       </Button>
       {hasImage && (
        <Button
         type="button"
         variant="ghost"
         size="sm"
         disabled={disabled || saving || busy}
         onClick={() => void remove()}
        >
         Удалить
        </Button>
       )}
       <span className="profile-media-hint">{pickHint}</span>
      </div>
     </section>
     <section className="profile-media-section">
      <h3>{target === 'avatar' ? 'Рамка' : 'Анимация'}</h3>
      <div
       className="profile-media-options"
       role="group"
       aria-label={target === 'avatar' ? 'Рамки аватара' : 'Анимации обложки'}
      >
       {OPTIONS[target].map(option => {
        const pressed = same(option.doc, frame, target);
        return (
         <button
          key={option.key}
          type="button"
          className="profile-media-option"
          aria-pressed={pressed}
          disabled={saving || busy}
          onClick={() => void apply(option.doc)}
         >
          <span className="profile-media-option-sample" data-target={target}>
           {target === 'avatar' ? (
            <UserAvatar
             user={{...user, avatar: ''}}
             size="xl"
             presence={false}
             decorative
             effectAsset={null}
             decoration={option.doc}
            />
           ) : (
            <ProfileCover
             user={{...user, cover: undefined}}
             accountId={`${user.id}-${option.key}`}
             className="profile-media-cover"
             decoration={option.doc}
             effectAsset={null}
            />
           )}
          </span>
          <span>{option.title}</span>
         </button>
        );
       })}
      </div>
      <Button
       type="button"
       variant="ghost"
       size="sm"
       className="profile-media-catalog"
       disabled={saving || busy}
       onClick={onCatalog}
      >
       <Sparkles />
       Каталог эффектов
      </Button>
     </section>
     {(error || notice) && (
      <p className={error ? 'profile-media-error' : 'profile-media-notice'} role={error ? 'alert' : 'status'}>
       {error || notice}
      </p>
     )}
     <footer>
      <Dialog.Close asChild>
       <Button type="button" variant="outline" disabled={saving || busy}>
        Готово
       </Button>
      </Dialog.Close>
     </footer>
    </Dialog.Content>
   </Dialog.Portal>
  </Dialog.Root>
 );
}
