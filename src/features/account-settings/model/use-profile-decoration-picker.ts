import {useEffect, useRef, useState} from 'react';
import {useStore} from 'zustand';
import type {ProfileDecorationDoc, ProfileEffect, User} from '@/shared/types';
import {sessionService} from '@/shared/api';
import {normalizeDecoration} from '@/shared/ui/avatar-fx';
import {
 asChoice,
 isCurrentEffect,
 isDraftPending,
 isGifHeader,
 localChoices,
 personalEffects,
 draftResult,
 effectKind
} from './profile-decoration-rules';
import {
 createProfileDecorationModel,
 presetsFor,
 type DecorationChoice,
 type DecorationView,
 type MediaTarget
} from './profile-decoration';

type Options = {
 user: User;
 target: MediaTarget;
 catalogSupported?: boolean;
 draftsSupported?: boolean;
 uploadsSupported?: boolean;
 onSave: (doc: ProfileDecorationDoc | null, id?: string) => Promise<void>;
 onClose: () => void;
};

/**
 * Единственное место, где живёт логика выбора украшения: каталог, GIF, генерация и
 * публикация. Компонент получает готовые данные и колбэки.
 */
export function useProfileDecorationPicker({
 user,
 target,
 catalogSupported,
 draftsSupported,
 uploadsSupported,
 onSave,
 onClose
}: Options) {
 const [model] = useState(() => createProfileDecorationModel({loading: Boolean(catalogSupported)}));
 const {actions} = model;
 const state = useStore(model.store);
 const alive = useRef(true);
 const scope = `${user.id}:${target}`;
 const scopeRef = useRef(scope);
 scopeRef.current = scope;

 useEffect(() => {
  alive.current = true;
  const invalidate = () => {
   alive.current = false;
  };
  window.addEventListener('authchange', invalidate);
  return () => {
   alive.current = false;
   window.removeEventListener('authchange', invalidate);
  };
 }, []);

 const checks = () => {
  const token = sessionService.token();
  return {
   isAlive: () => alive.current,
   isCurrentScope: () => alive.current && scopeRef.current === scope && sessionService.token() === token
  };
 };

 // Страница каталога перезапрашивается при смене вкладки, цели и по кнопке «Повторить».
 useEffect(() => {
  if (!catalogSupported || (state.view !== 'personal' && state.view !== 'catalog')) return;
  let current = true;
  const token = sessionService.token();
  void actions.loadPage({
   view: state.view,
   target,
   isAlive: () => current,
   isCurrentScope: () => sessionService.token() === token
  });
  return () => {
   current = false;
  };
 }, [actions, catalogSupported, state.view, target, state.reload]);

 // Проверка подписи GIF и предпросмотр: объектный URL живёт ровно столько, сколько выбранный файл.
 useEffect(() => {
  const file = state.file;
  if (state.view !== 'upload' || !file) return;
  let current = true;
  let url = '';
  void file
   .slice(0, 6)
   .text()
   .then(signature => {
    if (!current) return;
    if (!isGifHeader(signature)) {
     actions.setFileError('Выберите файл GIF.');
     actions.setFile(undefined);
     return;
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    url = URL.createObjectURL(file);
    actions.setPreview(url);
   })
   .catch(() => {
    if (!current) return;
    actions.setFileError('Не удалось прочитать GIF.');
    actions.setFile(undefined);
   });
  return () => {
   current = false;
   if (url) URL.revokeObjectURL(url);
  };
 }, [actions, state.file, state.view]);

 // Черновик генерации опрашивается, пока он в очереди или выполняется.
 useEffect(() => {
  const draft = state.draft;
  if (!isDraftPending(draft) || !draft || state.pollError) return;
  let current = true;
  const token = sessionService.token();
  const timeout = window.setTimeout(() => {
   void actions.refreshDraft({
    id: draft.id,
    isAlive: () => current,
    isCurrentScope: () => sessionService.token() === token
   });
  }, 1800);
  return () => {
   current = false;
   window.clearTimeout(timeout);
  };
 }, [actions, state.draft, state.pollError]);

 const currentDoc = user.decorations?.[target] ?? null;
 const currentRef = user.decorationRefs?.[target];
 const same = (left: ProfileDecorationDoc | null, right: ProfileDecorationDoc | null) =>
  JSON.stringify(normalizeDecoration(left, {target}).value) ===
  JSON.stringify(normalizeDecoration(right, {target}).value);
 const isCurrent = (item: DecorationChoice) => isCurrentEffect(item, currentRef, currentDoc, same);
 const localOptions = localChoices({
  view: state.view,
  target,
  presets: presetsFor(target),
  currentDoc,
  currentRef,
  same
 });
 const displayed =
  state.view === 'personal' ? personalEffects(state.recentUploads, state.page.items, target) : state.page.items;
 const items = [
  ...localOptions.map(choice => ({choice, kind: effectKind(choice), record: undefined})),
  ...displayed.map(item => {
   const choice = asChoice(item);
   return {choice, kind: effectKind(choice), record: item};
  })
 ];
 const draftReady = draftResult(state.draft, decoration => Boolean(normalizeDecoration(decoration, {target}).value));

 return {
  ...state,
  pending: isDraftPending(state.draft),
  draftReady,
  items,
  effectsCount: displayed.length,
  canApply: state.choice ? !isCurrent(state.choice) : false,
  isCurrent,
  catalogSupported: Boolean(catalogSupported),
  draftsSupported: Boolean(draftsSupported),
  uploadsSupported: Boolean(uploadsSupported),
  actions: {
   switchView: (next: DecorationView) => actions.switchView(next, Boolean(catalogSupported)),
   chooseFile: actions.chooseFile,
   setTitle: actions.setTitle,
   setPrompt: actions.setPrompt,
   select: actions.select,
   retry: actions.retry,
   clearPollError: () => actions.setPollError(''),
   loadMore: () => void actions.loadMore({target, catalogSupported: Boolean(catalogSupported), ...checks()}),
   upload: () => void actions.upload({target, uploadsSupported: Boolean(uploadsSupported), ...checks()}),
   generate: () => void actions.generate({target, ...checks()}),
   saveDraft: () => void actions.saveDraft({target, ...checks()}),
   apply: () => void actions.apply({onSave, onClose, isCurrent, ...checks()}),
   changeVisibility: (item: ProfileEffect) => void actions.changeVisibility(item, checks())
  }
 };
}

export type ProfileDecorationModel = ReturnType<typeof useProfileDecorationPicker>;
