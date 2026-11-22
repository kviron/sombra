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
    <Dialog.Overlay className="sticker-preview-overlay" />
    <Dialog.Content
     className="sticker-preview-dialog"
     aria-describedby={undefined}
     onCloseAutoFocus={event => {
      event.preventDefault();
      trigger.current?.focus({preventScroll: true});
     }}
    >
     <header>
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
       <div className="sticker-grid">
        {pack.stickers.map(sticker => (
         <StickerImage key={sticker.id} sticker={sticker} />
        ))}
       </div>
       {pack.owner === user ? (
        <p>Ваш набор</p>
       ) : pack.installed ? (
        <p role="status">Набор уже добавлен</p>
       ) : (
        <Button type="button" disabled={busy} onClick={() => void install()}>
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
  return <StickerImage className="sent-sticker" sticker={sticker} />;
 return (
  <>
   <button
    ref={trigger}
    type="button"
    className="sent-sticker-preview"
    aria-label={`Открыть набор «${sticker.pack}»`}
    onClick={() => setOpen(true)}
   >
    <StickerImage className="sent-sticker" sticker={sticker} />
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
  <span className="sticker-collection-art" aria-hidden="true">
   {stickers.length ? (
    stickers.slice(0, 4).map(sticker => <StickerImage key={sticker.id} sticker={sticker} />)
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
  <section aria-label="Публичные наборы" className="public-sticker-catalog">
   {error && <p role="alert">{error}</p>}
   {busy && <p role="status">Загрузка…</p>}
   {!packs.length && !busy && !error && <p>Пока нет опубликованных наборов.</p>}
   <div className="sticker-collection-tiles">
    {packs.map(pack => (
     <button
      key={pack.id}
      type="button"
      className="sticker-collection-tile"
      onClick={event => {
       trigger.current = event.currentTarget;
       actions.openPreview(pack.id);
      }}
     >
      <PackArt stickers={pack.stickers} />
      <span className="sticker-collection-label">
       <strong>{pack.name}</strong>
       <small>{catalogPackNote(pack, user)}</small>
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
   <label className="sticker-pack-name">
    Название набора
    <input
     value={name}
     maxLength={60}
     disabled={busy}
     onChange={event => actions.setName(event.target.value)}
     placeholder="Подставится из имени файла"
    />
   </label>
   <label className="sticker-upload">
    <Upload size={18} aria-hidden="true" />
    Импортировать ZIP или изображения
    <input
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
  <div className={group ? undefined : 'sticker-collection-tiles'}>
   {packs.map(([key, items]) => {
    const source = items[0],
     pack = source.pack || '',
     added = !group && !!source.packInstalled;
    return (
     <details key={key} className="sticker-pack">
      {group ? (
       <summary>
        {pack || 'Без набора'} · {items.length}
       </summary>
      ) : (
       <summary className="sticker-collection-tile">
        <PackArt stickers={items} />
        <span className="sticker-collection-label">
         <strong>{pack || 'Без набора'}</strong>
         <small>{libraryPackNote(items.length, source, added)}</small>
        </span>
       </summary>
      )}
      <div className="sticker-grid">
       {items.map(sticker => (
        <div key={sticker.id} className="sticker-library-item">
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
        <div className="sticker-remove-actions">
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
    <div className="sticker-collection-import">
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
     <div className="sticker-collection-toolbar settings-sticker-banner">
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
     <Tabs.List className="sticker-collection-tabs" aria-label="Коллекция стикеров">
      <Tabs.Trigger value="library">Личное</Tabs.Trigger>
      <Tabs.Trigger value="catalog">Общее</Tabs.Trigger>
     </Tabs.List>
     <Tabs.Content value="library" className="sticker-collection-panel">
      {feedback}
      {!packs.length && (
       <p className="sticker-collection-empty">
        Пока нет личных наборов. Импортируйте свой набор или найдите его в общем каталоге.
       </p>
      )}
      {packList}
     </Tabs.Content>
     <Tabs.Content value="catalog" className="sticker-collection-panel">
      {catalog ? (
       <PublicStickerCatalog key={user} user={user} refresh={refresh} />
      ) : (
       <p className="sticker-collection-empty">Этот сервер пока не поддерживает общий каталог стикеров.</p>
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
    <Dialog.Overlay className="sticker-collection-overlay" />
    <Dialog.Content
     className="sticker-collection-modal"
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
     <ScrollArea.Root className="sticker-collection-scroll">
      <ScrollArea.Viewport className="sticker-collection-viewport">
       <div className="sticker-collection-frame">
        <header>
         <div>
          <Dialog.Title>Коллекция стикеров</Dialog.Title>
          <Dialog.Description>Управляйте личными наборами и находите новые в общем каталоге.</Dialog.Description>
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
      <ScrollArea.Scrollbar orientation="vertical" className="sticker-collection-scrollbar">
       <ScrollArea.Thumb className="sticker-collection-thumb" />
      </ScrollArea.Scrollbar>
     </ScrollArea.Root>
    </Dialog.Content>
   </Dialog.Portal>
  </Dialog.Root>
 );
}
