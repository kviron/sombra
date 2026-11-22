import {useEffect, useRef, useState} from 'react';
import {useStore} from 'zustand';
import {createStickerPackPreviewModel} from './sticker-pack-preview';

type Options = {id: string; refresh: () => Promise<unknown>; onClose: () => void};

/** Предпросмотр набора: загрузка, ошибка и установка живут в модели окна. */
export function useStickerPackPreview({id, refresh, onClose}: Options) {
 const [model] = useState(createStickerPackPreviewModel);
 const state = useStore(model.store);
 const alive = useRef(true);

 useEffect(() => {
  alive.current = true;
  void model.actions.load({id, isAlive: () => alive.current});
  return () => {
   alive.current = false;
  };
 }, [id]); // окно пересоздаётся по id набора

 return {
  ...state,
  install: () => void model.actions.install({id, refresh, onClose, isAlive: () => alive.current})
 };
}
