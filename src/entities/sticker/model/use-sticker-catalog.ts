import {useEffect, useState} from 'react';
import {useStore} from 'zustand';
import {createStickerCatalogModel} from './sticker-catalog';

type Options = {user: string; refresh: () => Promise<unknown>};

/** Каталог стикеров: страницы, повтор загрузки и предпросмотр набора. */
export function useStickerCatalog({user, refresh}: Options) {
 const [model] = useState(createStickerCatalogModel);
 const state = useStore(model.store);

 useEffect(() => {
  let current = true;
  void model.actions.load({offset: state.offset, isAlive: () => current});
  return () => {
   current = false;
  };
 }, [state.offset, state.generation, user]); // новый аккаунт или страница перезапрашивают каталог

 return {
  ...state,
  actions: {
   nextPage: model.actions.nextPage,
   retry: model.actions.retry,
   openPreview: model.actions.openPreview,
   closePreview: model.actions.closePreview,
   /** Установка набора: обновляем данные аккаунта и помечаем набор добавленным. */
   refreshInstalled: async () => {
    await refresh();
    model.actions.markInstalled();
   }
  }
 };
}
