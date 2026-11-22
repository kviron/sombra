// Общий каталог стикеров: страницы, повтор загрузки и открытый предпросмотр набора.
import {createStore} from 'zustand/vanilla';
import {listPublicPacks, type PublicPack} from './public-packs';

export type StickerCatalogState = {
 packs: PublicPack[];
 next: number | null;
 busy: boolean;
 error: string;
 preview: string | undefined;
 offset: number;
 generation: number;
};

const initialState: StickerCatalogState = {
 packs: [],
 next: null,
 busy: true,
 error: '',
 preview: undefined,
 offset: 0,
 generation: 0
};

export function createStickerCatalogModel() {
 const store = createStore<StickerCatalogState>(() => initialState);

 const actions = {
  /** Страница каталога: первая заменяет список, следующая дополняет без повторов. */
  async load({offset, isAlive}: {offset: number; isAlive: () => boolean}) {
   store.setState({busy: true, error: ''});
   try {
    const {packs, nextOffset} = await listPublicPacks({offset});
    if (!isAlive()) return;
    store.setState(state => ({
     packs: offset ? [...new Map([...state.packs, ...packs].map(pack => [pack.id, pack])).values()] : packs,
     next: nextOffset
    }));
   } catch (reason) {
    if (isAlive()) store.setState({error: (reason as Error).message});
   } finally {
    if (isAlive()) store.setState({busy: false});
   }
  },
  nextPage() {
   const {next} = store.getState();
   if (next !== null) store.setState({offset: next});
  },
  retry() {
   store.setState(state => ({generation: state.generation + 1}));
  },
  openPreview(preview: string) {
   store.setState({preview});
  },
  closePreview() {
   store.setState({preview: undefined});
  },
  /** После установки набор помечается добавленным без повторной загрузки страницы. */
  markInstalled() {
   const {preview} = store.getState();
   store.setState(state => ({
    packs: state.packs.map(pack => (pack.id === preview ? {...pack, installed: true} : pack))
   }));
  }
 };

 return {store, actions};
}
