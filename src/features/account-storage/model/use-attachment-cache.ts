import {useCallback, useEffect, useRef, useState} from 'react';
import {useStore} from 'zustand';
import {createAttachmentCacheModel} from './attachment-cache';
import {
 CACHE_LIMIT_OPTIONS,
 cacheClearDisabled,
 cacheLimitValue,
 cacheSizeLabel,
 cacheSummary
} from './attachment-cache-rules';

const POLL_MS = 5000;

type Options = {ready: boolean; onChanged: () => Promise<unknown>};

/**
 * Единственное место, где живёт логика кэша вложений: опрос хранилища, лимит и очистка.
 * Компонент получает готовые данные и колбэки.
 */
export function useAttachmentCache({ready, onChanged}: Options) {
 const [model] = useState(() => createAttachmentCacheModel());
 const {actions} = model;
 const state = useStore(model.store);
 const alive = useRef(true);

 useEffect(() => {
  alive.current = true;
  return () => {
   alive.current = false;
  };
 }, []);

 // Сведения о хранилище обновляются по таймеру: кэш меняется и из других окон.
 useEffect(() => {
  const load = () => void actions.load({ready, isAlive: () => alive.current});
  load();
  const timer = window.setInterval(load, POLL_MS);
  return () => window.clearInterval(timer);
 }, [actions, ready]);

 const refresh = useCallback(() => actions.load({ready, isAlive: () => alive.current}), [actions, ready]);

 const setLimit = useCallback(
  (value: string) => void actions.setLimit(Number(value), {ready, onChanged, isAlive: () => alive.current}),
  [actions, onChanged, ready]
 );

 const clearCache = useCallback(
  () => void actions.clear({ready, onChanged, isAlive: () => alive.current}),
  [actions, onChanged, ready]
 );

 return {
  info: state.info,
  busy: state.busy,
  error: state.error,
  notice: state.notice,
  confirm: state.confirm,
  summary: cacheSummary(state.info),
  size: cacheSizeLabel(state.info),
  limit: cacheLimitValue(state.info),
  options: CACHE_LIMIT_OPTIONS,
  disabled: state.busy || !ready,
  clearDisabled: cacheClearDisabled(ready, state.busy, state.info),
  refresh,
  setLimit,
  clearCache,
  setConfirm: actions.setConfirm
 };
}

export type AttachmentCacheViewModel = ReturnType<typeof useAttachmentCache>;
