// Состояние звонков в переписке: ответ, начало, отклонение и защита от чужих ответов.
import {createStore} from 'zustand/vanilla';
import type {ChatState, DialogCall} from '@/shared/types';
import {callService} from './services/call-service';
import {callError, incomingCall, liveCall} from './dialog-calls-rules';
import type {Voice} from './use-voice';

export type DialogCallKind = 'join' | 'start' | 'decline';
export type DialogCallOperation = {id: string; kind: DialogCallKind; epoch: number};

export type DialogCallsState = {
 operation: DialogCallOperation | null;
 declining: DialogCallOperation | null;
 error: string;
 version: number;
};

export type DialogCallsContext = {
 state: ChatState | null;
 voice: Voice;
 refresh: () => Promise<unknown>;
 onOpenDialog: (id: string) => void;
};

/**
 * Хранилище создаётся на страницу: обработанные звонки и поколение аккаунта живут здесь,
 * а не в компоненте. Контекст (состояние чата, голос, обновление) приходит извне, чтобы
 * модель не держала React-замыканий.
 */
export function createDialogCallsModel(context: () => DialogCallsContext) {
 const store = createStore<DialogCallsState>(() => ({operation: null, declining: null, error: '', version: 0}));
 const scope = {
  account: context().state?.me.id as string | undefined,
  epoch: 0,
  handled: new Set<string>(),
  pending: null as DialogCallOperation | null
 };

 const tick = () => store.setState(state => ({version: state.version + 1}));

 const current = (op: DialogCallOperation) =>
  scope.epoch === op.epoch && scope.pending === op && context().state?.me.id === scope.account;

 const finish = (op: DialogCallOperation) => {
  if (!current(op)) return;
  scope.pending = null;
  store.setState({operation: null});
 };

 const begin = (id: string, kind: DialogCallKind): DialogCallOperation | null => {
  if (scope.pending || store.getState().declining?.id === id) return null;
  const op = {id, kind, epoch: scope.epoch};
  scope.pending = op;
  store.setState({operation: op, error: ''});
  return op;
 };

 const update = () => {
  void context()
   .refresh()
   .catch(() => {
    /* Poll will retry; refreshing must never hold the call action lock. */
   });
 };

 const incoming = () => {
  const {state, voice} = context();
  return incomingCall({
   calls: state?.dialogCalls || [],
   account: state?.me.id || '',
   room: voice.room,
   handled: scope.handled
  });
 };

 async function join(requested: DialogCall, video: boolean = requested.video) {
  const call = context().state?.dialogCalls?.find(item => item.id === requested.id);
  if (!call || !liveCall(call)) return;
  const op = begin(call.id, 'join');
  if (!op) return;
  try {
   const {voice, onOpenDialog} = context();
   if (voice.busy) {
    store.setState({
     error: 'Подключение или настройка устройства ещё выполняется. Повторите ответ или отклоните звонок.'
    });
    return;
   }
   const joined = await voice.join(call.id, video);
   if (!current(op)) return;
   if (!joined) {
    store.setState({error: 'Не удалось подключиться. Проверьте разрешения микрофона и камеры и повторите ответ.'});
    return;
   }
   scope.handled.add(call.id);
   onOpenDialog(call.dialog);
   update();
  } catch (reason) {
   if (current(op)) store.setState({error: callError(reason, 'Не удалось ответить. Повторите попытку.')});
  } finally {
   finish(op);
  }
 }

 async function start(dialog: string, video: boolean) {
  const existing = context().state?.dialogCalls?.find(call => call.dialog === dialog && liveCall(call));
  if (existing) {
   if (context().voice.room === existing.id) {
    if (video && !context().voice.camera) await context().voice.toggleCamera();
    return;
   }
   await join(existing, video);
   return;
  }
  const {voice} = context();
  if (voice.busy) return;
  const op = begin(dialog, 'start');
  if (!op) return;
  let created: DialogCall | undefined;
  try {
   created = await callService.start<DialogCall>({dialog, video});
   if (!current(op)) return;
   const joined = await voice.join(created.id, video);
   if (!current(op)) return;
   if (!joined) {
    await callService.cancel({call: created.id}).catch(() => {});
    if (current(op)) store.setState({error: 'Не удалось начать звонок. Проверьте доступ к микрофону и камере.'});
   } else {
    scope.handled.add(created.id);
    context().onOpenDialog(dialog);
   }
   update();
  } catch (reason) {
   if (current(op)) store.setState({error: reason instanceof Error ? reason.message : ''});
  } finally {
   finish(op);
  }
 }

 async function decline(requested: DialogCall) {
  // Closing is a local user decision, never conditional on network/server progress.
  // Retain this ID for the account lifetime so stale polls cannot reopen it.
  scope.handled.add(requested.id);
  tick();
  const pending = scope.pending;
  if (pending?.id === requested.id && pending.kind === 'join') {
   scope.pending = null;
   store.setState({operation: null});
   context().voice.leave();
  }
  const call = context().state?.dialogCalls?.find(item => item.id === requested.id);
  if (!call || store.getState().declining?.id === call.id) return;
  const op: DialogCallOperation = {id: call.id, kind: 'decline', epoch: scope.epoch};
  store.setState({declining: op, error: ''});
  const valid = () =>
   scope.epoch === op.epoch && store.getState().declining === op && context().state?.me.id === scope.account;
  try {
   await callService.decline({call: call.id});
   if (!valid()) return;
   scope.handled.add(call.id);
   update();
  } catch {
   if (valid())
    store.setState({error: 'Приглашение закрыто на этом устройстве. Сервер не подтвердил отклонение звонка.'});
  } finally {
   if (valid()) store.setState({declining: null});
  }
 }

 return {
  store,
  incoming,
  tick,
  /** Другой аккаунт: обработанные звонки и незавершённая операция прошлого больше не действуют. */
  syncAccount(account: string | undefined) {
   if (scope.account === account) return;
   scope.account = account;
   scope.epoch++;
   scope.handled = new Set();
   scope.pending = null;
   store.setState({operation: null, declining: null, error: ''});
  },
  /** Уход со страницы: незавершённый ответ не оставляет звонок висеть. */
  release() {
   scope.epoch++;
   const pending = scope.pending;
   if (pending?.kind === 'join' || pending?.kind === 'start') context().voice.leave();
   scope.pending = null;
  },
  /** Звонок исчез, пока шёл ответ: подключение отменяется. */
  expirePendingJoin() {
   const pending = scope.pending;
   if (!pending || pending.kind !== 'join') return;
   const {state, voice} = context();
   if ((state?.dialogCalls || []).some(call => call.id === pending.id && liveCall(call))) return;
   scope.pending = null;
   store.setState({operation: null});
   voice.leave();
  },
  start,
  join,
  decline,
  clearError: () => store.setState({error: ''})
 };
}

export type DialogCallsModel = ReturnType<typeof createDialogCallsModel>;
