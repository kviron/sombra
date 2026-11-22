// Предпросмотр одного публичного набора: загрузка по id и установка в личные стикеры.
import {createStore} from 'zustand/vanilla';
import {listPublicPacks, type PublicPack} from './public-packs';
import {stickerService} from './services/sticker-service';

export type StickerPackPreviewState = {pack: PublicPack | undefined; error: string; busy: boolean};

export function createStickerPackPreviewModel() {
 const store = createStore<StickerPackPreviewState>(() => ({pack: undefined, error: '', busy: false}));

 const actions = {
  async load({id, isAlive}: {id: string; isAlive: () => boolean}) {
   try {
    const {packs} = await listPublicPacks({packId: id});
    if (!isAlive()) return;
    store.setState({pack: packs[0]});
    if (!packs.length) store.setState({error: 'Этот набор больше не опубликован.'});
   } catch (reason) {
    if (isAlive()) store.setState({error: (reason as Error).message});
   }
  },

  async install({
   id,
   refresh,
   onClose,
   isAlive
  }: {
   id: string;
   refresh: () => Promise<unknown>;
   onClose: () => void;
   isAlive: () => boolean;
  }) {
   store.setState({busy: true, error: ''});
   try {
    await stickerService.installPublicPack({packId: id});
    await refresh();
    onClose();
   } catch (reason) {
    if (isAlive()) store.setState({error: (reason as Error).message});
   } finally {
    if (isAlive()) store.setState({busy: false});
   }
  }
 };

 return {store, actions};
}
