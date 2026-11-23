// Состояние кэша вложений: размер, лимит, очистка и подтверждение — в модели, не в компоненте.
import {createStore} from 'zustand/vanilla';
import {attachmentCacheService, type CacheInfo} from '@/shared/api';
import {cacheLimitNotice} from './attachment-cache-rules';

export type AttachmentCacheState = {
 info: CacheInfo | null;
 busy: boolean;
 error: string;
 notice: string;
 confirm: boolean;
};

const initialState: AttachmentCacheState = {
 info: null,
 busy: false,
 error: '',
 notice: '',
 confirm: false
};

export type LoadArgs = {ready: boolean; isAlive: () => boolean};

export type ChangeArgs = LoadArgs & {
 action: () => Promise<CacheInfo>;
 message: string;
 onChanged: () => Promise<unknown>;
};

export type OperationArgs = Omit<ChangeArgs, 'action' | 'message'>;

/**
 * Хранилище создаётся на открытый раздел: сведения и подтверждение очистки не переживают
 * закрытие настроек, а поздний ответ прошлого запроса не попадает в новый раздел.
 */
export function createAttachmentCacheModel() {
 const store = createStore<AttachmentCacheState>(() => initialState);
 let request = 0;

 async function load({ready, isAlive}: LoadArgs) {
  if (!ready || store.getState().busy) return;
  const sequence = ++request;
  try {
   const info = await attachmentCacheService.info();
   if (isAlive() && sequence === request) store.setState({info, error: ''});
  } catch (reason) {
   if (isAlive() && sequence === request)
    store.setState({error: reason instanceof Error ? reason.message : 'Не удалось прочитать кэш.'});
  }
 }

 async function change({action, message, ready, onChanged, isAlive}: ChangeArgs) {
  if (store.getState().busy || !ready) return;
  request++;
  store.setState({busy: true, error: '', notice: ''});
  try {
   const info = await action();
   if (isAlive()) store.setState({info, confirm: false, notice: message});
   await onChanged().catch(() => {});
  } catch (reason) {
   if (isAlive()) store.setState({error: reason instanceof Error ? reason.message : 'Не удалось изменить кэш.'});
  } finally {
   if (isAlive()) store.setState({busy: false});
  }
 }

 const actions = {
  setConfirm(confirm: boolean) {
   store.setState({confirm});
  },
  load,
  setLimit(limitMiB: number, args: OperationArgs) {
   return change({
    action: () => attachmentCacheService.setLimit(limitMiB),
    message: cacheLimitNotice(limitMiB),
    ...args
   });
  },
  clear(args: OperationArgs) {
   return change({action: attachmentCacheService.clear, message: 'Локальный кэш очищен.', ...args});
  }
 };

 return {store, actions};
}

export type AttachmentCacheModel = ReturnType<typeof createAttachmentCacheModel>;
