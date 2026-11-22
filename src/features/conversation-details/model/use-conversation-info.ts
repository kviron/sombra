import {useCallback, useEffect, useMemo, useRef} from 'react';
import {useStore} from 'zustand';
import type {ChatState, Dialog, User} from '@/shared/types';
import {
 canEditDialog,
 canSaveDialog,
 conversationInfoActions,
 conversationInfoStore,
 conversationScope,
 isEmailQuery,
 memberSearchHint,
 memberSearchKey,
 visibleMemberIds
} from './conversation-info';
import {conversationService} from '@/entities/conversation';

type Options = {
 chat: ChatState;
 channel: string;
 memberIds: string[];
 dialog: Dialog | undefined;
 onSaved: ((owner: string, dialog: Dialog) => Promise<void>) | undefined;
};

/**
 * Единственное место, где живёт логика информации о чате: черновик, поиск участников,
 * сохранение. Компонент получает готовые данные и колбэки.
 */
export function useConversationInfo({chat, channel, memberIds, dialog, onSaved}: Options) {
 const state = useStore(conversationInfoStore);
 const alive = useRef(true);
 const scope = conversationScope(chat, channel);
 const scopeRef = useRef(scope);
 scopeRef.current = scope;
 const liveDialog = useRef(dialog);
 liveDialog.current = dialog;
 const searchEpoch = useRef(0);
 const editable = canEditDialog(chat, dialog);

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

 // Другой чат или другой аккаунт — чистый черновик.
 useEffect(() => {
  conversationInfoActions.reset();
 }, [scope]);

 const normalizedQuery = state.memberQuery.trim().toLocaleLowerCase();
 const key = memberSearchKey(chat, channel, normalizedQuery, memberIds);
 const remote = state.memberResult?.key === key ? state.memberResult : undefined;
 const pending = isEmailQuery(normalizedQuery) && chat.conversationMemberSearchSupported === true && !remote;

 // Поиск по email: с задержкой и защитой от гонок — этим занимается модель, не UI.
 useEffect(() => {
  const epoch = ++searchEpoch.current;
  if (!isEmailQuery(normalizedQuery) || !chat.conversationMemberSearchSupported) return;
  const timer = window.setTimeout(() => {
   void conversationService
    .searchMembers<{users: User[]}>({channel, query: normalizedQuery})
    .then(result => {
     if (searchEpoch.current === epoch && alive.current) {
      conversationInfoActions.setMemberResult({
       key,
       users: result.users.filter(user => memberIds.includes(user.id))
      });
     }
    })
    .catch((reason: unknown) => {
     if (searchEpoch.current === epoch && alive.current) {
      conversationInfoActions.setMemberResult({
       key,
       users: [],
       error: reason instanceof Error ? reason.message : 'Не удалось найти участников.'
      });
     }
    });
  }, 250);
  return () => {
   window.clearTimeout(timer);
   if (searchEpoch.current === epoch) searchEpoch.current++;
  };
 }, [key, normalizedQuery, channel, chat.conversationMemberSearchSupported, memberIds.join(',')]);

 const shown = useMemo(
  () => visibleMemberIds({chat, channel, memberIds, query: state.memberQuery, remote}),
  [chat, channel, memberIds, state.memberQuery, remote]
 );

 const hint = memberSearchHint({
  query: state.memberQuery,
  supported: chat.conversationMemberSearchSupported === true,
  pending,
  remote,
  shown: shown.length
 });

 const save = useCallback(
  () =>
   conversationInfoActions.save({
    chat,
    editable,
    onSaved,
    isAlive: () => alive.current,
    isCurrentScope: () => scopeRef.current === scope,
    currentDialog: () => liveDialog.current
   }),
  [chat, channel, editable, onSaved, scope]
 );

 return {
  editable,
  editing: state.editing,
  name: state.name,
  image: state.image,
  busy: state.busy,
  error: state.error,
  crop: state.crop,
  memberQuery: state.memberQuery,
  shown,
  remote,
  hint,
  pending,
  canSave: canSaveDialog(state.name, state.image, dialog),
  scope,
  searchEpoch,
  actions: {
   begin: () => dialog && conversationInfoActions.begin(dialog),
   cancel: conversationInfoActions.cancel,
   setName: conversationInfoActions.setName,
   setImage: conversationInfoActions.setImage,
   setCrop: conversationInfoActions.setCrop,
   setMemberQuery: conversationInfoActions.setMemberQuery,
   save
  }
 };
}

export type ConversationInfoModel = ReturnType<typeof useConversationInfo>;

/** Какая ошибка относится к устаревшей ревизии: тогда черновик начинается с новой. */
export const isConflict = (error: string) => /CONFLICT|Диалог изменён/i.test(error);
