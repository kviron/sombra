import {Input} from '@/shared/ui/input';
import {cn} from '@/shared/lib/utils';
import {useRef, useState} from 'react';
import {Dialog, ScrollArea, Tabs} from 'radix-ui';
import {ArrowLeft, Plus, Sticker as StickerIcon, Upload, X} from 'lucide-react';
import './sticker-catalog.css';
import {Button} from '@/shared/ui/button';
import type {Sticker} from '@/shared/types';
import {useStickerImage} from '../model/use-sticker-image';
import {useStickerLibrary} from '../model/use-sticker-library';
import {useStickerCatalog} from '../model/use-sticker-catalog';
import {useStickerPackPreview} from '../model/use-sticker-pack-preview';
import {catalogPackNote, libraryPackNote, shouldPreviewSentSticker} from '../model/sticker-library-rules';

/** Карточка набора: одна и та же кнопка в каталоге и summary в личной библиотеке. */
const tileClass = cn(
 'sticker-collection-tile',
 'grid w-full min-w-0 cursor-pointer gap-2 rounded-[12px] border border-border p-2 text-left',
 'bg-muted hover:border-ring',
 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
);

/** Вкладка «Личное» / «Общее»: форма задаётся здесь, рамку переопределяют настройки. */
const tabClass = cn(
 'min-h-9 cursor-pointer rounded-[7px] px-3.5 py-1 text-sm text-muted-foreground',
 'data-[state=active]:bg-accent data-[state=active]:text-foreground',
 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
);

export function StickerImage({sticker, className}: {sticker: Sticker; className?: string}) {
 const ref = useRef<HTMLImageElement>(null);
 const image = useStickerImage({sticker, target: ref});
 return <img ref={ref} className={className} src={image} alt={sticker.name} draggable={false} />;
}

function StickerPackPreview({
 id,
 user,
 refresh,
 onClose,
 trigger
}: {
 id: string;
 user: string;
 refresh: () => Promise<unknown>;
 onClose: () => void;
 trigger: React.RefObject<HTMLButtonElement | null>;
}) {
 const {pack, error, busy, install} = useStickerPackPreview({id, refresh, onClose});
 return (
  <Dialog.Root
   open
   onOpenChange={open => {
    if (!open) onClose();
   }}
  >
   <Dialog.Portal>
    <Dialog.Overlay className="sticker-preview-overlay bg-muted fixed inset-0 z-[140]" />
    <Dialog.Content
     className="sticker-preview-dialog fixed top-1/2 left-1/2 z-[141] grid max-h-[calc(100vh_-_32px)] w-[min(420px,calc(100vw_-_32px))] [transform:translate(-50%,-50%)] gap-4 overflow-auto rounded-[var(--radius)] border border-[var(--border)] bg-[var(--popover)] p-4 text-[var(--popover-foreground)] [box-shadow:0_12px_48px_#0007]"
     aria-describedby={undefined}
     onCloseAutoFocus={event => {
      event.preventDefault();
      trigger.current?.focus({preventScroll: true});
     }}
    >
     <header className="flex items-center justify-between gap-3">
      <Dialog.Title>{pack?.name || 'Набор стикеров'}</Dialog.Title>
      <Dialog.Close asChild>
       <Button size="icon-sm" variant="ghost" aria-label="Закрыть">
        <X />
       </Button>
      </Dialog.Close>
     </header>
     {error && <p role="alert">{error}</p>}
     {!pack && !error && <p role="status">Загрузка…</p>}
     {pack && (
      <>
       <div className="sticker-grid grid max-h-[220px] grid-cols-[repeat(3,1fr)] gap-2 overflow-auto">
        {pack.stickers.map(sticker => (
         <StickerImage key={sticker.id} sticker={sticker} />
        ))}
       </div>
       {pack.owner === user ? (
        <p>Ваш набор</p>
       ) : pack.installed ? (
        <p role="status">Набор уже добавлен</p>
       ) : (
        <Button className="justify-self-start" type="button" disabled={busy} onClick={() => void install()}>
         Добавить в мои стикеры
        </Button>
       )}
      </>
     )}
    </Dialog.Content>
   </Dialog.Portal>
  </Dialog.Root>
 );
}

export function SentSticker({
 sticker,
 user,
 catalog,
 refresh
}: {
 sticker: Sticker;
 user: string;
 catalog?: boolean;
 refresh: () => Promise<unknown>;
}) {
 // Открыт ли предпросмотр набора — состояние одного стикера, поэтому остаётся в интерфейсе.
 const [open, setOpen] = useState(false),
  trigger = useRef<HTMLButtonElement>(null);
 const id = sticker.packId;
 if (!id || !shouldPreviewSentSticker(sticker, user, catalog))
  return <StickerImage className="sent-sticker my-2 size-[144px] object-contain" sticker={sticker} />;
 return (
  <>
   <button
    ref={trigger}
    type="button"
    className="sent-sticker-preview inline-block cursor-pointer rounded-[var(--radius)] border-0 bg-none p-0 hover:bg-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--ring)]"
    aria-label={`Открыть набор «${sticker.pack}»`}
    onClick={() => setOpen(true)}
   >
    <StickerImage className="sent-sticker my-2 size-[144px] object-contain" sticker={sticker} />
   </button>
   {open && (
    <StickerPackPreview
     key={id}
     user={user}
     id={id}
     refresh={refresh}
     trigger={trigger}
     onClose={() => setOpen(false)}
    />
   )}
  </>
 );
}

function PackArt({stickers}: {stickers: Sticker[]}) {
 return (
  <span
   className="sticker-collection-art bg-muted text-muted-foreground grid min-h-[72px] auto-cols-[minmax(0,1fr)] grid-flow-col place-items-center gap-1 rounded-[8px] p-2"
   aria-hidden="true"
  >
   {stickers.length ? (
    stickers
     .slice(0, 4)
     .map(sticker => <StickerImage className="h-14 w-full object-contain" key={sticker.id} sticker={sticker} />)
   ) : (
    <StickerIcon />
   )}
  </span>
 );
}

function PublicStickerCatalog({user, refresh}: {user: string; refresh: () => Promise<unknown>}) {
 const {packs, next, busy, error, preview, actions} = useStickerCatalog({user, refresh});
 const trigger = useRef<HTMLButtonElement | null>(null);
 return (
  <section
   aria-label="Публичные наборы"
   className="public-sticker-catalog grid w-full min-w-0 justify-items-start gap-3"
  >
   {error && <p role="alert">{error}</p>}
   {busy && <p role="status">Загрузка…</p>}
   {!packs.length && !busy && !error && (
    <p className="text-muted-foreground text-sm">Пока нет опубликованных наборов.</p>
   )}
   <div className="grid w-full min-w-0 grid-cols-[repeat(auto-fill,minmax(min(100%,180px),1fr))] items-start gap-3">
    {packs.map(pack => (
     <button
      key={pack.id}
      type="button"
      className={tileClass}
      onClick={event => {
       trigger.current = event.currentTarget;
       actions.openPreview(pack.id);
      }}
     >
      <PackArt stickers={pack.stickers} />
      <span className="sticker-collection-label">
       <strong className="block text-sm [overflow-wrap:anywhere]">{pack.name}</strong>
       <small className="text-muted-foreground block text-xs [overflow-wrap:anywhere]">
        {catalogPackNote(pack, user)}
       </small>
      </span>
     </button>
    ))}
   </div>
   {error ? (
    <Button size="sm" variant="outline" onClick={actions.retry}>
     Повторить
    </Button>
   ) : (
    next !== null && (
     <Button size="sm" variant="outline" disabled={busy} onClick={actions.nextPage}>
      Ещё наборы
     </Button>
    )
   )}
   {preview && (
    <StickerPackPreview
     user={user}
     id={preview}
     trigger={trigger}
     onClose={actions.closePreview}
     refresh={actions.refreshInstalled}
    />
   )}
  </section>
 );
}

type LibraryProps = {
 stickers: Sticker[];
 user: string;
 group?: string;
 catalog?: boolean;
 refresh: () => Promise<unknown>;
};

/** Компонент только показывает: наборы, прогресс и удаление приходят из модели среза. */
export function StickerLibrary({stickers, user, group, catalog, refresh}: LibraryProps) {
 const {name, progress, error, busy, confirm, tab, adding, packs, actions} = useStickerLibrary({
  stickers,
  user,
  group,
  refresh
 });
 const addTrigger = useRef<HTMLButtonElement>(null);
 const importForm = (
  <>
   <label className={cn('sticker-pack-name', 'grid gap-2 text-sm')}>
    Название набора
    <Input
     value={name}
     maxLength={60}
     disabled={busy}
     onChange={event => actions.setName(event.target.value)}
     placeholder="Подставится из имени файла"
    />
   </label>
   <label
    className={cn(
     'sticker-upload border-border relative flex cursor-pointer items-center justify-center gap-2 rounded-[10px] border border-dashed p-3 text-[12px]',
     'mt-3'
    )}
   >
    <Upload size={18} aria-hidden="true" />
    Импортировать ZIP или изображения
    <Input
     type="file"
     accept=".zip,image/png,image/webp"
     multiple
     disabled={busy}
     onChange={event => {
      const files = Array.from(event.target.files || []);
      event.target.value = '';
      actions.upload(files);
     }}
    />
   </label>
  </>
 );
 const feedback = (
  <>
   {progress && <p role="status">{progress}</p>}
   {error && <p role="alert">{error}</p>}
  </>
 );
 const packList = (
  <div
   className={
    group
     ? undefined
     : 'grid w-full min-w-0 grid-cols-[repeat(auto-fill,minmax(min(100%,180px),1fr))] items-start gap-3'
   }
  >
   {packs.map(([key, items]) => {
    const source = items[0],
     pack = source.pack || '',
     added = !group && !!source.packInstalled;
    return (
     <details
      key={key}
      className="sticker-pack group open:border-border m-0 min-w-0 rounded-none border-0 bg-transparent p-0 open:col-span-full open:rounded-[12px] open:border open:p-2"
     >
      {group ? (
       <summary>
        {pack || 'Без набора'} · {items.length}
       </summary>
      ) : (
       <summary className={cn(tileClass, 'group-open:border-ring group-open:bg-accent')}>
        <PackArt stickers={items} />
        <span className="sticker-collection-label">
         <strong className="block text-sm [overflow-wrap:anywhere]">{pack || 'Без набора'}</strong>
         <small className="text-muted-foreground block text-xs [overflow-wrap:anywhere]">
          {libraryPackNote(items.length, source, added)}
         </small>
        </span>
       </summary>
      )}
      <div className="sticker-grid grid max-h-[220px] grid-cols-[repeat(3,1fr)] gap-2 overflow-auto">
       {items.map(sticker => (
        <div key={sticker.id} className="sticker-library-item grid justify-items-center">
         <StickerImage sticker={sticker} />
         {!added && (
          <Button
           type="button"
           size="xs"
           variant="ghost"
           aria-label={`Удалить стикер «${sticker.name}»`}
           disabled={busy}
           onClick={() => actions.remove(pack, sticker)}
          >
           Удалить
          </Button>
         )}
        </div>
       ))}
      </div>
      {!group && catalog && source.packId && (
       <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => actions.changePack(source)}>
        {added ? 'Убрать из моих стикеров' : source.packPublic ? 'Снять с публикации' : 'Опубликовать'}
       </Button>
      )}
      {!added &&
       pack &&
       (confirm === key ? (
        <div className="sticker-remove-actions flex gap-2">
         <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={actions.cancelRemove}>
          Отмена
         </Button>
         <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={() => actions.remove(pack)}>
          Подтвердить удаление
         </Button>
        </div>
       ) : (
        <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={() => actions.askRemove(key)}>
         Удалить набор
        </Button>
       ))}
     </details>
    );
   })}
  </div>
 );
 if (group)
  return (
   <section className="sticker-library">
    {importForm}
    {feedback}
    {!packs.length && <p>Пока нет стикеров.</p>}
    {packList}
   </section>
  );
 return (
  <section className="sticker-library sticker-collection">
   {adding ? (
    <div className="sticker-collection-import grid justify-items-start gap-3">
     {importForm}
     {feedback}
     <Button
      type="button"
      variant="ghost"
      disabled={busy}
      onClick={() => {
       actions.backToPacks();
       requestAnimationFrame(() => addTrigger.current?.focus());
      }}
     >
      <ArrowLeft />
      Назад к наборам
     </Button>
    </div>
   ) : (
    <Tabs.Root value={tab} onValueChange={actions.setTab}>
     <div className="sticker-collection-toolbar settings-sticker-banner mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="settings-sticker-intro">
       <StickerIcon aria-hidden="true" />
       <div>
        <strong>Свой набор</strong>
        <p>Загрузите ZIP-архив со стикерами.</p>
       </div>
      </div>

      <Button ref={addTrigger} type="button" variant="outline" disabled={busy} onClick={actions.beginImport}>
       <Plus />
       Добавить свой набор
      </Button>
     </div>
     <h2 className="settings-sticker-heading">Коллекция стикеров</h2>
     <Tabs.List
      className="sticker-collection-tabs bg-muted flex gap-1 rounded-[10px] p-1"
      aria-label="Коллекция стикеров"
     >
      <Tabs.Trigger className={tabClass} value="library">
       Личное
      </Tabs.Trigger>
      <Tabs.Trigger className={tabClass} value="catalog">
       Общее
      </Tabs.Trigger>
     </Tabs.List>
     <Tabs.Content value="library" className="sticker-collection-panel">
      {feedback}
      {!packs.length && (
       <p className="sticker-collection-empty text-muted-foreground text-sm">
        Пока нет личных наборов. Импортируйте свой набор или найдите его в общем каталоге.
       </p>
      )}
      {packList}
     </Tabs.Content>
     <Tabs.Content value="catalog" className="sticker-collection-panel">
      {catalog ? (
       <PublicStickerCatalog key={user} user={user} refresh={refresh} />
      ) : (
       <p className="sticker-collection-empty text-muted-foreground text-sm">
        Этот сервер пока не поддерживает общий каталог стикеров.
       </p>
      )}
     </Tabs.Content>
    </Tabs.Root>
   )}
  </section>
 );
}

export function StickerCollectionModal({
 open,
 onOpenChange,
 ...props
}: Omit<LibraryProps, 'group'> & {open: boolean; onOpenChange: (open: boolean) => void}) {
 const opener = useRef<HTMLElement | null>(null);
 return (
  <Dialog.Root open={open} onOpenChange={onOpenChange}>
   <Dialog.Portal>
    <Dialog.Overlay className="sticker-collection-overlay fixed inset-0 z-[130]" />
    <Dialog.Content
     className="sticker-collection-modal border-border bg-card text-foreground fixed top-1/2 left-1/2 z-[131] w-[min(820px,calc(100vw_-_32px))] [transform:translate(-50%,-50%)] overflow-hidden rounded-[16px] border [box-shadow:0_20px_60px_#080a1080] [--sticker-modal-inset:64px]"
     onOpenAutoFocus={() => {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
     }}
     onCloseAutoFocus={event => {
      if (opener.current?.isConnected) {
       event.preventDefault();
       opener.current.focus({preventScroll: true});
      }
     }}
    >
     <ScrollArea.Root className="sticker-collection-scroll relative overflow-hidden">
      <ScrollArea.Viewport className="sticker-collection-viewport max-h-[calc(100dvh_-_var(--sticker-modal-inset)_-_2px)] w-full [overscroll-behavior:contain]">
       <div className="sticker-collection-frame grid gap-5 p-6">
        <header className="flex items-center justify-between gap-3">
         <div>
          <Dialog.Title>Коллекция стикеров</Dialog.Title>
          <Dialog.Description className="text-muted-foreground mt-1.5 mb-0 text-sm">
           Управляйте личными наборами и находите новые в общем каталоге.
          </Dialog.Description>
         </div>
         <Dialog.Close asChild>
          <Button type="button" variant="ghost" size="icon-lg" aria-label="Закрыть коллекцию стикеров">
           <X />
          </Button>
         </Dialog.Close>
        </header>
        <StickerLibrary key={props.user} {...props} />
       </div>
      </ScrollArea.Viewport>
      <ScrollArea.Scrollbar
       orientation="vertical"
       className="sticker-collection-scrollbar flex w-[9px] [touch-action:none] p-0.5 select-none"
      >
       <ScrollArea.Thumb className="sticker-collection-thumb bg-muted hover:bg-muted relative flex-1 rounded-[999px]" />
      </ScrollArea.Scrollbar>
     </ScrollArea.Root>
    </Dialog.Content>
   </Dialog.Portal>
  </Dialog.Root>
 );
}
