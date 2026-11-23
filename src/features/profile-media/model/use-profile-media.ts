import {useCallback, useEffect, useRef, useState} from 'react';
import {useStore} from 'zustand';
import type {ProfileDecorationDoc, User} from '@/shared/types';
import {createProfileMediaModel, isDecorationSelected, mediaOptions} from './profile-media';
import type {MediaTarget} from './profile-decoration';
import {mediaDescription, mediaFrame, mediaHasImage, mediaTitle} from './profile-media-rules';

type Options = {
 user: User;
 target: MediaTarget;
 busy: boolean;
 onApply: (doc: ProfileDecorationDoc | null) => Promise<void>;
 onRemove: () => Promise<void>;
};

/**
 * Единственное место, где живёт логика диалога медиа: сохранение, удаление и возврат фокуса.
 * Компонент получает готовые данные и колбэки.
 */
export function useProfileMedia({user, target, busy, onApply, onRemove}: Options) {
 const [model] = useState(() => createProfileMediaModel(target));
 const {saving, error, notice} = useStore(model.store);
 const alive = useRef(true);
 const origin = useRef<HTMLElement | null>(null);

 useEffect(() => {
  alive.current = true;
  return () => {
   alive.current = false;
  };
 }, []);

 // Фокус возвращается туда, откуда открыли диалог: это часть доступности, а не разметки.
 useEffect(() => {
  origin.current = document.activeElement as HTMLElement | null;
 }, []);

 const frame = mediaFrame(user, target);

 const apply = useCallback(
  (doc: ProfileDecorationDoc | null) => model.actions.apply(doc, {busy, isAlive: () => alive.current, onApply}),
  [busy, model, onApply]
 );

 const remove = useCallback(
  () => model.actions.remove({busy, isAlive: () => alive.current, onRemove}),
  [busy, model, onRemove]
 );

 return {
  title: mediaTitle(target),
  description: mediaDescription(target),
  hasImage: mediaHasImage(user, target),
  frame,
  options: mediaOptions(target),
  isSelected: (doc: ProfileDecorationDoc | null) => isDecorationSelected(doc, frame, target),
  saving,
  busy: saving || busy,
  error,
  notice,
  origin,
  apply,
  remove
 };
}

export type ProfileMediaViewModel = ReturnType<typeof useProfileMedia>;
