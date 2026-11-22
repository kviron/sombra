// Черновик окна «Подключения»: имя, логин, показанный ключ и открытые настройки бота.
// Хранилище фабричное: окно монтируется заново на каждое открытие, а показанный ключ
// не должен пережить его — модульный store оставил бы секрет на экране страницы.
import {createStore} from 'zustand/vanilla';
import {botService} from '@/features/bots';
import type {Bot} from '@/shared/types';
import {
 botActionFailed,
 botCopyFailed,
 botRemoveConfirm,
 botRotateConfirm,
 createBotPayload,
 removeBotPayload
} from './chat-bots-rules';

export type ChatBotsState = {
 name: string;
 username: string;
 token: string;
 busy: boolean;
 copied: boolean;
 managementId: string;
};

const initialState: ChatBotsState = {
 name: '',
 username: '',
 token: '',
 busy: false,
 copied: false,
 managementId: ''
};

/** Колбэки страницы: обновление снапшота и общая ошибка окна. */
export type BotsContext = {refresh: () => Promise<unknown>; onError: (message: string) => void};

export function createChatBotsModel() {
 const store = createStore<ChatBotsState>(() => initialState);

 /** Общий ход действия: занятость, новый ключ из ответа, обновление снапшота и одна ошибка. */
 const run = async (action: () => Promise<unknown>, {refresh, onError}: BotsContext) => {
  store.setState({busy: true});
  try {
   const result = (await action()) as {token?: string} | undefined;
   if (result?.token) store.setState({token: result.token, copied: false});
   await refresh();
  } catch {
   onError(botActionFailed);
  } finally {
   store.setState({busy: false});
  }
 };

 const actions = {
  setName(name: string) {
   store.setState({name});
  },
  setUsername(username: string) {
   store.setState({username});
  },
  /** Ключ показывается один раз: скрывает его только явное подтверждение. */
  dismissToken() {
   store.setState({token: '', copied: false});
  },
  openManagement(managementId: string) {
   store.setState({managementId});
  },
  closeManagement() {
   store.setState({managementId: ''});
  },
  create({channel, group, refresh, onError}: BotsContext & {channel: string; group: string | undefined}) {
   const {name, username} = store.getState();
   return run(() => botService.create(createBotPayload({group, channel, name, username})), {refresh, onError});
  },
  rotate({bot, refresh, onError}: BotsContext & {bot: Bot}) {
   if (!window.confirm(botRotateConfirm)) return;
   return run(() => botService.rotateToken({bot: bot.id}), {refresh, onError});
  },
  remove({bot, group, refresh, onError}: BotsContext & {bot: Bot; group: string | undefined}) {
   if (!window.confirm(botRemoveConfirm)) return;
   const payload = removeBotPayload({bot, group});
   return run(() => (group && !bot.channel ? botService.removeFromGroup(payload) : botService.remove(payload)), {
    refresh,
    onError
   });
  },
  async copyToken({onError}: Pick<BotsContext, 'onError'>) {
   try {
    await navigator.clipboard.writeText(store.getState().token);
    store.setState({copied: true});
   } catch {
    onError(botCopyFailed);
   }
  }
 };

 return {store, actions};
}
