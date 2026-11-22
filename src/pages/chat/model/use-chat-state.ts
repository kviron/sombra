import {useEffect} from 'react';
import {useStore} from 'zustand';
import {chatSnapshotActions, chatSnapshotStore} from './chat-state';

/**
 * Единственное место, где живёт снапшот страницы: опрос, пауза при скрытом документе,
 * перезагрузка по возвращению в окно и общая ошибка загрузки.
 */
export function useChatState() {
 const {snapshot, error, busy} = useStore(chatSnapshotStore);

 useEffect(() => {
  let active = true;
  const load = () => void chatSnapshotActions.load(() => active);
  const shown = () => {
   if (document.visibilityState === 'visible') load();
  };
  load();
  const timer = setInterval(load, 2000);
  document.addEventListener('visibilitychange', shown);
  return () => {
   active = false;
   clearInterval(timer);
   document.removeEventListener('visibilitychange', shown);
   // Страница закрылась: чужой сеанс не должен увидеть снапшот прошлого.
   chatSnapshotActions.reset();
  };
 }, []);

 return {
  state: snapshot,
  error,
  busy,
  actions: {
   setError: chatSnapshotActions.setError,
   clearError: chatSnapshotActions.clearError,
   refresh: () => chatSnapshotActions.refresh(),
   applyState: chatSnapshotActions.applyState,
   savedDialogMetadata: chatSnapshotActions.savedDialogMetadata,
   applyChatPreferences: chatSnapshotActions.applyChatPreferences,
   mediaSaved: chatSnapshotActions.mediaSaved,
   equipProfileEffect: chatSnapshotActions.equipProfileEffect
  }
 };
}

export type ChatStateModel = ReturnType<typeof useChatState>;
