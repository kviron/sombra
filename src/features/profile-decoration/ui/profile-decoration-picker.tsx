import {useRef} from 'react';
import {Dialog, ScrollArea} from 'radix-ui';
import {Check, Plus, Upload, X} from 'lucide-react';
import {type ProfileDecorationDoc, type ProfileEffect, type ProfileEffectAsset, type User} from '@/shared/types';
import {UserAvatar} from '@/shared/ui/user-avatar';
import {ProfileEffectImage} from '@/shared/ui/profile-effect-image';
import {ProfileCover} from '@/shared/ui/profile-cover';
import {Button} from '@/shared/ui/button';
import {useProfileDecorationPicker} from '../model/use-profile-decoration-picker';
import type {DecorationChoice, MediaTarget} from '../model/profile-decoration';
import '@/shared/ui/menu-material.css';
import './profile-decoration-picker.css';

export type {MediaTarget};
const MAX_EFFECT_TITLE = 64;

function EffectSample({
 user,
 target,
 decoration,
 asset
}: {
 user: User;
 target: MediaTarget;
 decoration: ProfileDecorationDoc | null;
 asset?: ProfileEffectAsset;
}) {
 return (
  <span className="profile-effect-sample" data-avatar-fx-priority="picker" aria-hidden="true">
   {target === 'avatar' ? (
    <UserAvatar user={user} size="xl" presence={false} decorative decoration={decoration} effectAsset={null} />
   ) : (
    <ProfileCover user={user} accountId={user.id} decoration={decoration} effectAsset={null} />
   )}
   <ProfileEffectImage asset={asset} className="profile-effect-image" />
  </span>
 );
}

/**
 * Компонент только показывает: каталог, черновики генерации, загрузка GIF и публикация
 * приходят из модели среза, поэтому здесь остались разметка и фокус заголовка.
 */
export function ProfileDecorationPicker({
 user,
 target,
 catalogSupported,
 draftsSupported,
 uploadsSupported,
 onSave,
 onClose,
 onRestoreFocus
}: {
 user: User;
 target: MediaTarget;
 catalogSupported?: boolean;
 draftsSupported?: boolean;
 uploadsSupported?: boolean;
 onSave: (doc: ProfileDecorationDoc | null, id?: string) => Promise<void>;
 onClose: () => void;
 onRestoreFocus: () => void;
}) {
 const model = useProfileDecorationPicker({
  user,
  target,
  catalogSupported,
  draftsSupported,
  uploadsSupported,
  onSave,
  onClose
 });
 const {
  view,
  file,
  title,
  preview,
  fileError,
  page,
  pageLoading,
  pageError,
  choice,
  busy,
  error,
  notice,
  prompt,
  draft,
  pollError,
  pending,
  draftReady,
  items,
  effectsCount,
  canApply,
  isCurrent,
  actions
 } = model;
 const heading = useRef<HTMLHeadingElement>(null);

 function renderCard(item: DecorationChoice, kind: string, record?: ProfileEffect) {
  const selected = choice?.key === item.key || (!choice && isCurrent(item));
  const card = (
   <button
    key={item.key}
    type="button"
    className="profile-effect-card"
    aria-pressed={selected}
    disabled={busy}
    onClick={() => actions.select(item)}
   >
    <EffectSample user={user} target={target} decoration={item.decoration} asset={item.asset} />
    <span className="profile-effect-title">
     <span>
      <strong>{item.title}</strong>
      <small>{kind}</small>
     </span>
     {selected && <Check size={16} aria-hidden="true" />}
    </span>
   </button>
  );
  if (!record || record.ownerId !== user.id) return card;
  return (
   <div className="profile-effect-entry" key={item.key}>
    {card}
    <div className="profile-effect-visibility">
     <span>{record.public ? 'В каталоге' : 'Личный'}</span>
     <button
      type="button"
      disabled={busy}
      aria-label={`${record.public ? 'Скрыть из каталога' : 'Опубликовать в каталоге'}: ${item.title}`}
      onClick={() => actions.changeVisibility(record)}
     >
      {record.public ? 'Скрыть' : 'Опубликовать'}
     </button>
    </div>
   </div>
  );
 }

 return (
  <Dialog.Root
   open
   onOpenChange={open => {
    if (!open && !busy) onClose();
   }}
  >
   <Dialog.Portal>
    <Dialog.Overlay className="profile-effects-overlay" />
    <Dialog.Content
     className="profile-effects-dialog dark surface-matte"
     data-target={target}
     aria-busy={busy}
     onOpenAutoFocus={event => {
      event.preventDefault();
      heading.current?.focus();
     }}
     onCloseAutoFocus={event => {
      event.preventDefault();
      onRestoreFocus();
     }}
     onEscapeKeyDown={event => {
      if (busy) event.preventDefault();
      event.stopPropagation();
     }}
     onInteractOutside={event => {
      if (busy) event.preventDefault();
     }}
    >
     <ScrollArea.Root className="profile-effects-scroll" type="hover">
      <ScrollArea.Viewport className="profile-effects-viewport">
       <div className="profile-effects-body">
        <header>
         <div>
          <Dialog.Title ref={heading} tabIndex={-1}>
           {view === 'upload' ? 'Добавить свою GIF' : target === 'avatar' ? 'Эффект аватара' : 'Эффект обложки'}
          </Dialog.Title>
          <Dialog.Description>
           {view === 'upload'
            ? 'Выберите файл и проверьте, как он выглядит.'
            : 'Выберите готовый эффект или добавьте свою анимацию.'}
          </Dialog.Description>
         </div>
         <Dialog.Close asChild>
          <Button type="button" variant="ghost" size="icon" disabled={busy} aria-label="Закрыть выбор эффекта">
           <X />
          </Button>
         </Dialog.Close>
        </header>
        <div className="profile-effect-toolbar">
         <div className="profile-effect-tabs" role="group" aria-label="Коллекция эффектов">
          <button
           type="button"
           aria-pressed={view === 'personal'}
           disabled={busy}
           onClick={() => actions.switchView('personal')}
          >
           Личное
          </button>
          <button
           type="button"
           aria-pressed={view === 'catalog'}
           disabled={busy}
           onClick={() => actions.switchView('catalog')}
          >
           Общее
          </button>
         </div>
         <div className="profile-effect-actions">
          {draftsSupported && (
           <Button
            type="button"
            variant="ghost"
            aria-pressed={view === 'create'}
            disabled={busy}
            onClick={() => actions.switchView('create')}
           >
            Создать эффект
           </Button>
          )}
          <Button
           type="button"
           variant="outline"
           aria-pressed={view === 'upload'}
           disabled={busy}
           onClick={() => actions.switchView('upload')}
          >
           <Plus aria-hidden="true" />
           Добавить свою GIF
          </Button>
         </div>
        </div>
        {view === 'upload' ? (
         <form
          className="profile-effect-form"
          onSubmit={event => {
           event.preventDefault();
           actions.upload();
          }}
         >
          {uploadsSupported ? (
           <div className="profile-effect-upload">
            <Upload size={22} aria-hidden="true" />
            <label htmlFor="profile-effect-file">Файл анимации</label>
            <input
             id="profile-effect-file"
             type="file"
             accept="image/gif,.gif"
             required
             disabled={busy}
             onChange={event => actions.chooseFile(event.currentTarget.files?.[0])}
            />
            <p>GIF · до 2 МиБ. При сохранении эффект останется личным.</p>
            {fileError && <p role="alert">{fileError}</p>}
            {file && preview && (
             <div className="profile-effect-upload-preview">
              <img src={preview} alt="Предпросмотр GIF" />
             </div>
            )}
            <label htmlFor="profile-effect-name">Название</label>
            <input
             id="profile-effect-name"
             type="text"
             required
             maxLength={MAX_EFFECT_TITLE}
             value={title}
             disabled={busy}
             onChange={event => actions.setTitle(event.target.value)}
             placeholder="Название эффекта"
            />
           </div>
          ) : (
           <p role="status">
            Этот сервер пока не поддерживает загрузку GIF. Готовые эффекты доступны в разделе «Личное».
           </p>
          )}
          <footer>
           <Button type="button" variant="ghost" disabled={busy} onClick={() => actions.switchView('personal')}>
            Назад
           </Button>
           {uploadsSupported && (
            <Button type="submit" disabled={busy || !file || !title.trim()}>
             Добавить в личное
            </Button>
           )}
          </footer>
         </form>
        ) : view === 'create' ? (
         <form
          className="profile-effect-form"
          onSubmit={event => {
           event.preventDefault();
           actions.generate();
          }}
         >
          <label htmlFor="profile-effect-prompt">Как должен выглядеть эффект?</label>
          <textarea
           id="profile-effect-prompt"
           rows={3}
           required
           maxLength={400}
           value={prompt}
           disabled={busy || pending}
           onChange={event => actions.setPrompt(event.target.value)}
           placeholder={
            target === 'avatar' ? 'Например, тёплые искры по краю аватара' : 'Например, звёзды над ночным городом'
           }
          />
          <p>Сначала появится превью. Сохранённый черновик будет личным, пока вы не опубликуете его сами.</p>
          {pending && <p role="status">{draft?.status === 'queued' ? 'Черновик в очереди…' : 'Создаём эффект…'}</p>}
          {pollError && (
           <p role="alert">
            {pollError}{' '}
            <Button type="button" variant="outline" onClick={actions.clearPollError}>
             Проверить ещё раз
            </Button>
           </p>
          )}
          {draft?.status === 'failed' && (
           <p role="alert">{draft.error || 'Не удалось создать эффект. Попробуйте ещё раз.'}</p>
          )}
          {draft?.status === 'ready' && !draftReady && (
           <p role="alert">Не удалось показать этот эффект. Попробуйте создать его снова.</p>
          )}
          {draftReady && (
           <div className="profile-effect-draft">
            <EffectSample user={user} target={target} decoration={draftReady.decoration} />
            <strong>{draftReady.title}</strong>
           </div>
          )}
          <footer>
           <Button
            type="submit"
            variant={draftReady ? 'outline' : 'default'}
            disabled={busy || pending || !prompt.trim()}
           >
            {draft ? 'Создать заново' : 'Создать превью'}
           </Button>
           {draftReady && (
            <Button type="button" disabled={busy} onClick={actions.saveDraft}>
             Сохранить черновик
            </Button>
           )}
          </footer>
         </form>
        ) : (
         <>
          <div
           className="profile-effect-options"
           role="group"
           aria-label={target === 'avatar' ? 'Рамки аватара' : 'Эффекты обложки'}
          >
           {items.map(({choice: item, kind, record}) => renderCard(item, kind, record))}
          </div>
          {!catalogSupported && view === 'catalog' && (
           <p className="profile-effect-state" role="status">
            Этот сервер пока не поддерживает общий каталог. Готовые эффекты доступны в разделе «Личное».
           </p>
          )}
          {pageLoading && (
           <p className="profile-effect-state" role="status">
            Загружаем эффекты…
           </p>
          )}
          {pageError && (
           <div className="profile-effect-state" role="alert">
            {pageError}{' '}
            <Button type="button" variant="outline" disabled={busy} onClick={actions.retry}>
             Повторить
            </Button>
           </div>
          )}
          {catalogSupported && !pageLoading && !pageError && !effectsCount && (
           <p className="profile-effect-state">
            {view === 'catalog'
             ? 'В каталоге пока нет эффектов для этого раздела.'
             : 'Здесь появятся созданные вами эффекты и эффекты, которые вы примените из каталога.'}
           </p>
          )}
          {page.nextOffset !== null && (
           <Button type="button" variant="outline" disabled={busy || pageLoading} onClick={actions.loadMore}>
            Показать ещё
           </Button>
          )}
          <footer>
           <Dialog.Close asChild>
            <Button type="button" variant="ghost" disabled={busy}>
             Отмена
            </Button>
           </Dialog.Close>
           <Button type="button" disabled={busy || !canApply} onClick={actions.apply}>
            Применить
           </Button>
          </footer>
         </>
        )}
        {error && (
         <p className="profile-effect-error" role="alert">
          {error}
         </p>
        )}
        {notice && (
         <p className="profile-effect-state" role="status">
          {notice}
         </p>
        )}
       </div>
      </ScrollArea.Viewport>
      <ScrollArea.Scrollbar className="profile-effects-scrollbar" orientation="vertical">
       <ScrollArea.Thumb className="profile-effects-thumb" />
      </ScrollArea.Scrollbar>
     </ScrollArea.Root>
    </Dialog.Content>
   </Dialog.Portal>
  </Dialog.Root>
 );
}
