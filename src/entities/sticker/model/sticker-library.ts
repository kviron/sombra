import {createStore} from 'zustand/vanilla';
import type {Sticker} from '@/shared/types';
import {stickerService} from './services/sticker-service';
import {encodeSticker, stickerFiles} from './sticker-archive';
import {importCountError, packName, stickerBatches, stickerName} from './sticker-library-rules';

export type StickerLibraryState = {
 name: string;
 progress: string;
 error: string;
 busy: boolean;
 confirm: string | undefined;
 tab: string;
 adding: boolean;
};

const initialState: StickerLibraryState = {
 name: '',
 progress: '',
 error: '',
 busy: false,
 confirm: undefined,
 tab: 'library',
 adding: false
};

export type StickerLibraryArgs = {
 group: string | undefined;
 refresh: () => Promise<unknown>;
 isAlive: () => boolean;
};

export type StickerUploadArgs = StickerLibraryArgs & {files: File[]};

/** Хранилище одного открытого окна библиотеки: черновик набора, прогресс, подтверждение удаления. */
export function createStickerLibraryModel() {
 const store = createStore<StickerLibraryState>(() => initialState);

 const actions = {
  setName(name: string) {
   store.setState({name});
  },
  setTab(tab: string) {
   store.setState({tab});
  },
  /** Переход к форме импорта: вкладка «Личное», старые сообщения убираются. */
  beginImport() {
   store.setState({tab: 'library', progress: '', error: '', adding: true});
  },
  backToPacks() {
   store.setState({adding: false});
  },
  askRemove(key: string) {
   store.setState({confirm: key});
  },
  cancelRemove() {
   store.setState({confirm: undefined});
  },

  /** Импорт набора: разбор файлов, подготовка картинок и отправка пачками. */
  async upload({files, group, refresh, isAlive}: StickerUploadArgs) {
   const {busy, name} = store.getState();
   if (!files.length || busy) return;
   store.setState({busy: true, error: '', progress: 'Подготавливаем набор…'});
   try {
    const {items, title} = await stickerFiles(files);
    const pack = packName(name, title, files);
    const countError = importCountError(items.length);
    if (countError) throw new Error(countError);
    const prepared: {name: string; image: string; keywords?: string[]}[] = [];
    for (const item of items)
     prepared.push({name: stickerName(item.name), image: await encodeSticker(item.file), keywords: item.keywords});
    let uploaded = 0;
    for (const batch of stickerBatches(prepared)) {
     await stickerService.importPack({group, pack, stickers: batch});
     uploaded += batch.length;
     if (isAlive()) store.setState({progress: `Загружено ${uploaded} из ${prepared.length}`});
    }
    await refresh();
    if (isAlive()) store.setState({name: '', progress: `Набор «${pack}» загружен · ${items.length} стикеров`});
   } catch (reason) {
    if (isAlive()) store.setState({progress: '', error: (reason as Error).message});
    await refresh().catch(() => {});
   } finally {
    if (isAlive()) store.setState({busy: false});
   }
  },

  /** Удаление одного стикера или всего набора: сервер различает их полем sticker. */
  async remove(pack: string, sticker: Sticker | undefined, {group, refresh, isAlive}: StickerLibraryArgs) {
   store.setState({busy: true, error: '', progress: ''});
   try {
    await stickerService.remove({group, pack, sticker: sticker?.id});
    await refresh();
    if (isAlive()) store.setState({confirm: undefined});
   } catch (reason) {
    if (isAlive()) store.setState({error: (reason as Error).message});
   } finally {
    if (isAlive()) store.setState({busy: false});
   }
  },

  /** Публикация набора, снятие с публикации или удаление установленного набора. */
  async changePack(sticker: Sticker, {refresh, isAlive}: StickerLibraryArgs) {
   store.setState({busy: true, error: '', progress: ''});
   try {
    if (sticker.packInstalled) await stickerService.removeInstalledPack({packId: sticker.packId});
    else
     await stickerService.setPackPublic({
      packId: sticker.packId,
      pack: sticker.pack,
      public: !sticker.packPublic
     });
    await refresh();
   } catch (reason) {
    if (isAlive()) store.setState({error: (reason as Error).message});
   } finally {
    if (isAlive()) store.setState({busy: false});
   }
  }
 };

 return {store, actions};
}

export type StickerLibraryModel = ReturnType<typeof createStickerLibraryModel>;

export {personalSticker, stickerPackKey} from './sticker-library-rules';
