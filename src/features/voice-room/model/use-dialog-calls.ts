import {useEffect, useRef, useState} from 'react';
import {useStore} from 'zustand';
import type {ChatState} from '@/shared/types';
import {createDialogCallsModel, type DialogCallsContext} from './dialog-calls';
import {callsBusy, incomingCallsBusy} from './dialog-calls-rules';
import type {Voice} from './use-voice';
import {startIncomingRingtone} from './voice-cues';

type Options = {
 state: ChatState | null;
 voice: Voice;
 refresh: () => Promise<unknown>;
 onOpenDialog: (id: string) => void;
};

/**
 * Единственное место, где живёт логика звонков в переписке: входящий, ответ, начало и
 * отклонение. Компонент получает готовые данные и колбэки.
 */
export function useDialogCalls({state, voice, refresh, onOpenDialog}: Options) {
 const latest = useRef<DialogCallsContext>({state, voice, refresh, onOpenDialog});
 latest.current = {state, voice, refresh, onOpenDialog};
 const [model] = useState(() => createDialogCallsModel(() => latest.current));
 const stored = useStore(model.store);
 const account = state?.me.id;
 const calls = state?.dialogCalls || [];
 const incoming = model.incoming();
 const busy = callsBusy(stored.operation, stored.declining);
 const incomingBusy = incomingCallsBusy({operation: stored.operation, declining: stored.declining, id: incoming?.id});

 const ringtoneId = !incomingBusy && !voice.deaf ? incoming?.id : undefined;
 const {
  speakerOutput,
  preferences: {volume}
 } = voice;
 useEffect(() => {
  if (ringtoneId) return startIncomingRingtone(speakerOutput, volume);
 }, [ringtoneId, speakerOutput, volume]);

 // Секундный тик нужен только чтобы истёкший звонок перестал считаться входящим.
 useEffect(() => {
  const timer = window.setInterval(model.tick, 1000);
  return () => window.clearInterval(timer);
 }, [model]);

 // Ответ ждёт звонка: если звонок исчез, подключение отменяется.
 useEffect(() => {
  model.expirePendingJoin();
 }, [model, state, incoming?.id]);

 // Другой аккаунт — чистые обработанные звонки и закрытая операция.
 useEffect(() => {
  model.syncAccount(account);
 }, [model, account]);

 // Уход со страницы или смена аккаунта отпускает незавершённое подключение.
 useEffect(() => () => model.release(), [model, account]);

 return {
  calls,
  incoming,
  busy,
  incomingBusy,
  incomingDeclining: !!(stored.declining && stored.declining.id === incoming?.id),
  error: stored.error,
  start: model.start,
  join: model.join,
  decline: model.decline,
  clearError: model.clearError
 };
}

export type DialogCallsViewModel = ReturnType<typeof useDialogCalls>;
