import {useRef} from 'react';
import {Dialog, ScrollArea} from 'radix-ui';
import {Check, Plus, Upload, X} from 'lucide-react';
import {type ProfileDecorationDoc, type ProfileEffect, type ProfileEffectAsset, type User} from '@/shared/types';
import {UserAvatar} from '@/shared/ui/user-avatar';
import {ProfileEffectImage} from '@/shared/ui/profile-effect-image';
import {ProfileCover} from '@/shared/ui/profile-cover';
import {Button} from '@/shared/ui/button';
import {cn} from '@/shared/lib';
import {useProfileDecorationPicker} from '../model/use-profile-decoration-picker';
import type {DecorationChoice, MediaTarget} from '../model/profile-decoration';
import '@/shared/ui/menu-material.css';
import './profile-decoration-picker.css';

export type {MediaTarget};
const MAX_EFFECT_TITLE = 64;
/** Абзацы формы: те же размеры, что были у `.profile-effect-form p`. */
const note = 'm-0 text-sm leading-[1.45] text-muted-foreground [overflow-wrap:anywhere]';

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
  <span
   className={cn(
    'profile-effect-sample',
    'relative isolate grid min-w-0 place-items-center overflow-hidden rounded-[6px]'
   )}
   data-avatar-fx-priority="picker"
   aria-hidden="true"
  >
   {target === 'avatar' ? (
    <UserAvatar user={user} size="xl" presence={false} decorative decoration={decoration} effectAsset={null} />
   ) : (
    <ProfileCover user={user} accountId={user.id} decoration={decoration} effectAsset={null} />
   )}
   <ProfileEffectImage
    asset={asset}
    className="profile-effect-image pointer-events-none absolute inset-0 z-[2] size-full object-cover"
   />
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
    className={cn(
     'profile-effect-card',
     'border-border bg-card text-card-foreground grid h-full w-full min-w-0 cursor-pointer grid-rows-[auto_1fr] gap-2 rounded-[12px] border p-2 text-left',
     'hover:enabled:bg-accent aria-pressed:border-ring aria-pressed:bg-accent disabled:cursor-default'
    )}
    aria-pressed={selected}
    disabled={busy}
    onClick={() => actions.select(item)}
   >
    <EffectSample user={user} target={target} decoration={item.decoration} asset={item.asset} />
    <span
     className={cn(
      'profile-effect-title',
      'flex items-center justify-between gap-2 px-0.5 pt-0 pb-0.5 [overflow-wrap:anywhere] [&_svg]:shrink-0'
     )}
    >
     <span>
      <strong className="block text-sm leading-[1.4]">{item.title}</strong>
      <small className="text-muted-foreground block text-xs leading-[1.4]">{kind}</small>
     </span>
     {selected && <Check size={16} aria-hidden="true" />}
    </span>
   </button>
  );
  if (!record || record.ownerId !== user.id) return card;
  return (
   <div className={cn('profile-effect-entry', 'grid min-w-0 grid-rows-[1fr_auto] items-start')} key={item.key}>
    {card}
    <div
     className={cn(
      'profile-effect-visibility',
      'text-muted-foreground flex flex-wrap items-center justify-between px-1 py-0 text-xs'
     )}
    >
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
     className={cn(
      'profile-effects-dialog dark surface-matte',
      'fixed inset-[50%_auto_auto_50%] z-[1401] w-[min(820px,calc(100vw_-_32px))] [transform:translate(-50%,-50%)] overflow-hidden rounded-[16px]'
     )}
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
     <ScrollArea.Root className={cn('profile-effects-scroll', 'relative overflow-hidden')} type="hover">
      <ScrollArea.Viewport className={cn('profile-effects-viewport', 'max-h-[calc(100dvh_-_34px)] w-full')}>
       <div className={cn('profile-effects-body', 'grid gap-5 p-6')}>
        <header className="flex items-start justify-between gap-3">
         <div>
          <Dialog.Title ref={heading} tabIndex={-1} className="m-0 text-2xl leading-[1.2] font-[650]">
           {view === 'upload' ? 'Добавить свою GIF' : target === 'avatar' ? 'Эффект аватара' : 'Эффект обложки'}
          </Dialog.Title>
          <Dialog.Description className="text-muted-foreground mt-1.5 mb-0 text-sm leading-[1.5]">
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
        <div className={cn('profile-effect-toolbar', 'flex flex-wrap items-center justify-between gap-2')}>
         <div
          className={cn('profile-effect-tabs', 'flex gap-1 rounded-[10px] p-1')}
          role="group"
          aria-label="Коллекция эффектов"
         >
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
         <div className={cn('profile-effect-actions', 'flex flex-wrap items-center gap-2')}>
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
          className={cn('profile-effect-form', 'grid min-w-0 gap-2')}
          onSubmit={event => {
           event.preventDefault();
           actions.upload();
          }}
         >
          {uploadsSupported ? (
           <div
            className={cn(
             'profile-effect-upload',
             'border-border bg-card grid justify-items-start gap-2 rounded-[12px] border border-dashed p-4'
            )}
           >
            <Upload size={22} aria-hidden="true" />
            <label htmlFor="profile-effect-file">Файл анимации</label>
            <input
             id="profile-effect-file"
             type="file"
             accept="image/gif,.gif"
             required
             disabled={busy}
             className="max-w-full [font:inherit]"
             onChange={event => actions.chooseFile(event.currentTarget.files?.[0])}
            />
            <p className={note}>GIF · до 2 МиБ. При сохранении эффект останется личным.</p>
            {fileError && (
             <p className={note} role="alert">
              {fileError}
             </p>
            )}
            {file && preview && (
             <div className="profile-effect-upload-preview bg-popover w-[min(100%,320px)] overflow-hidden rounded-[8px]">
              <img src={preview} alt="Предпросмотр GIF" className="block h-[140px] w-full object-contain" />
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
             className="border-border bg-popover text-card-foreground min-h-11 w-[min(100%,320px)] rounded-[8px] border px-3 py-2"
             onChange={event => actions.setTitle(event.target.value)}
             placeholder="Название эффекта"
            />
           </div>
          ) : (
           <p className={note} role="status">
            Этот сервер пока не поддерживает загрузку GIF. Готовые эффекты доступны в разделе «Личное».
           </p>
          )}
          <footer className="flex flex-wrap justify-end gap-2">
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
          className={cn('profile-effect-form', 'grid min-w-0 gap-2')}
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
           className="border-border bg-card text-card-foreground min-h-[88px] w-full resize-y rounded-[8px] border px-3 py-2 [font:inherit]"
          />
          <p className={note}>
           Сначала появится превью. Сохранённый черновик будет личным, пока вы не опубликуете его сами.
          </p>
          {pending && (
           <p className={note} role="status">
            {draft?.status === 'queued' ? 'Черновик в очереди…' : 'Создаём эффект…'}
           </p>
          )}
          {pollError && (
           <p className={note} role="alert">
            {pollError}{' '}
            <Button type="button" variant="outline" onClick={actions.clearPollError}>
             Проверить ещё раз
            </Button>
           </p>
          )}
          {draft?.status === 'failed' && (
           <p className={note} role="alert">
            {draft.error || 'Не удалось создать эффект. Попробуйте ещё раз.'}
           </p>
          )}
          {draft?.status === 'ready' && !draftReady && (
           <p className={note} role="alert">
            Не удалось показать этот эффект. Попробуйте создать его снова.
           </p>
          )}
          {draftReady && (
           <div
            className={cn(
             'profile-effect-draft',
             'border-border bg-card grid max-w-60 gap-2 rounded-[12px] border p-2 text-center [overflow-wrap:anywhere]'
            )}
           >
            <EffectSample user={user} target={target} decoration={draftReady.decoration} />
            <strong>{draftReady.title}</strong>
           </div>
          )}
          <footer className="flex flex-wrap justify-end gap-2">
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
           className={cn('profile-effect-options', 'grid grid-cols-3 gap-3')}
           role="group"
           aria-label={target === 'avatar' ? 'Рамки аватара' : 'Эффекты обложки'}
          >
           {items.map(({choice: item, kind, record}) => renderCard(item, kind, record))}
          </div>
          {!catalogSupported && view === 'catalog' && (
           <p className={cn('profile-effect-state', note, 'text-muted-foreground')} role="status">
            Этот сервер пока не поддерживает общий каталог. Готовые эффекты доступны в разделе «Личное».
           </p>
          )}
          {pageLoading && (
           <p className={cn('profile-effect-state', note, 'text-muted-foreground')} role="status">
            Загружаем эффекты…
           </p>
          )}
          {pageError && (
           <div className={cn('profile-effect-state', note, 'text-muted-foreground')} role="alert">
            {pageError}{' '}
            <Button type="button" variant="outline" disabled={busy} onClick={actions.retry}>
             Повторить
            </Button>
           </div>
          )}
          {catalogSupported && !pageLoading && !pageError && !effectsCount && (
           <p className={cn('profile-effect-state', note, 'text-muted-foreground')}>
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
          <footer className="flex flex-wrap justify-end gap-2">
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
         <p className={cn('profile-effect-error', note)} role="alert">
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
      <ScrollArea.Scrollbar
       className={cn('profile-effects-scrollbar', 'flex w-2.5 touch-none p-0.5 select-none')}
       orientation="vertical"
      >
       <ScrollArea.Thumb className={cn('profile-effects-thumb', 'relative flex-1 rounded-full')} />
      </ScrollArea.Scrollbar>
     </ScrollArea.Root>
    </Dialog.Content>
   </Dialog.Portal>
  </Dialog.Root>
 );
}
