import {useEffect, useMemo, useRef, useState} from 'react';
import {useStore} from 'zustand';
import type {Sticker} from '@/shared/types';
import {createStickerLibraryModel} from './sticker-library';
import {groupStickersByPack, libraryStickers} from './sticker-library-rules';

type Options = {stickers: Sticker[]; user: string; group?: string; refresh: () => Promise<unknown>};

/**
 * Единственное место логики библиотеки: черновик импорта, прогресс и удаление.
 * Компонент получает готовые наборы и колбэки.
 */
export function useStickerLibrary({stickers, user, group, refresh}: Options) {
 const [model] = useState(createStickerLibraryModel);
 const state = useStore(model.store);
 const alive = useRef(true);

 useEffect(() => {
  alive.current = true;
  return () => {
   alive.current = false;
  };
 }, []);

 const library = useMemo(() => libraryStickers(stickers, user, group), [stickers, user, group]);
 const packs = useMemo(() => groupStickersByPack(library), [library]);
 const context = {group, refresh, isAlive: () => alive.current};

 // Хранилище создаётся один раз на экземпляр: два открытых окна библиотеки не делят черновик.
 return {
  ...state,
  packs,
  actions: {
   setName: model.actions.setName,
   setTab: model.actions.setTab,
   beginImport: model.actions.beginImport,
   backToPacks: model.actions.backToPacks,
   askRemove: model.actions.askRemove,
   cancelRemove: model.actions.cancelRemove,
   upload: (files: File[]) => void model.actions.upload({...context, files}),
   remove: (pack: string, sticker?: Sticker) => void model.actions.remove(pack, sticker, context),
   changePack: (sticker: Sticker) => void model.actions.changePack(sticker, context)
  }
 };
}
