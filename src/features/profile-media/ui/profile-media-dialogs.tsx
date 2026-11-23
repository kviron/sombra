import {useRef} from 'react';
import {Dialog} from 'radix-ui';
import {Sparkles, Upload, X} from 'lucide-react';
import type {ProfileDecorationDoc, ProfileEffectTarget, User} from '@/shared/types';
import {UserAvatar} from '@/shared/ui/user-avatar';
import {ProfileCover} from '@/shared/ui/profile-cover';
import {Button} from '@/shared/ui/button';
import {useProfileMedia} from '../model/use-profile-media';
import './profile-media-dialogs.css';

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
 target: ProfileEffectTarget;
 busy: boolean;
 disabled: boolean;
 pickHint: string;
 onPickImage: () => void;
 onRemove: () => Promise<void>;
 onApply: (doc: ProfileDecorationDoc | null) => Promise<void>;
 onCatalog: () => void;
 onClose: () => void;
}) {
 const heading = useRef<HTMLHeadingElement>(null);
 const model = useProfileMedia({user, target, busy, onApply, onRemove});
 return (
  <Dialog.Root
   open
   onOpenChange={open => {
    if (!open && !model.busy) onClose();
   }}
  >
   <Dialog.Portal>
    <Dialog.Overlay className="profile-media-overlay" />
    <Dialog.Content
     className="profile-media-dialog dark"
     data-target={target}
     aria-busy={model.busy}
     onOpenAutoFocus={event => {
      event.preventDefault();
      heading.current?.focus();
     }}
     onCloseAutoFocus={event => {
      event.preventDefault();
      model.origin.current?.focus();
     }}
     onEscapeKeyDown={event => {
      if (model.busy) event.preventDefault();
     }}
     onInteractOutside={event => {
      if (model.busy) event.preventDefault();
     }}
    >
     <header>
      <div>
       <Dialog.Title ref={heading} tabIndex={-1}>
        {model.title}
       </Dialog.Title>
       <Dialog.Description>{model.description}</Dialog.Description>
      </div>
      <Dialog.Close asChild>
       <Button type="button" variant="ghost" size="icon" disabled={model.busy} aria-label="Закрыть окно">
        <X />
       </Button>
      </Dialog.Close>
     </header>
     <section className="profile-media-section">
      <h3>Изображение</h3>
      <div className="profile-media-picture" data-kind={target}>
       {target === 'avatar' ? (
        <UserAvatar user={user} size="xl" presence={false} decorative effectAsset={null} decoration={model.frame} />
       ) : (
        <ProfileCover
         user={user}
         accountId={user.id}
         className="profile-media-cover"
         decoration={model.frame}
         effectAsset={null}
        />
       )}
      </div>
      <div className="profile-media-picture-actions">
       <Button type="button" variant="outline" size="sm" disabled={disabled || model.busy} onClick={onPickImage}>
        <Upload />
        Загрузить
       </Button>
       {model.hasImage && (
        <Button
         type="button"
         variant="ghost"
         size="sm"
         disabled={disabled || model.busy}
         onClick={() => void model.remove()}
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
       {model.options.map(option => {
        const pressed = model.isSelected(option.doc);
        return (
         <button
          key={option.key}
          type="button"
          className="profile-media-option"
          aria-pressed={pressed}
          disabled={model.busy}
          onClick={() => void model.apply(option.doc)}
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
       disabled={model.busy}
       onClick={onCatalog}
      >
       <Sparkles />
       Каталог эффектов
      </Button>
     </section>
     {(model.error || model.notice) && (
      <p
       className={model.error ? 'profile-media-error' : 'profile-media-notice'}
       role={model.error ? 'alert' : 'status'}
      >
       {model.error || model.notice}
      </p>
     )}
     <footer>
      <Dialog.Close asChild>
       <Button type="button" variant="outline" disabled={model.busy}>
        Готово
       </Button>
      </Dialog.Close>
     </footer>
    </Dialog.Content>
   </Dialog.Portal>
  </Dialog.Root>
 );
}
