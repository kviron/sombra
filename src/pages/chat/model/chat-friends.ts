// Действия списка друзей: заявка, принятие, отказ и начало переписки.
// Хранилище фабричное: вкладка и поиск принадлежат показанному представлению, которое
// монтируется при входе в «Друзья» и снимается при уходе; модульный store оставил бы
// чужой поиск следующему открытию.
import {createStore} from 'zustand/vanilla';
import {conversationService} from '@/entities/conversation';
import {friendService} from '@/entities/user';
import type {Dialog} from '@/shared/types';
import type {FriendTab} from './chat-friends-rules';

export type ChatFriendsState = {tab: FriendTab; query: string; busy: boolean};

/** Колбэки страницы: обновление снапшота, общая ошибка и открытие диалога. */
export type FriendsContext = {refresh: () => Promise<unknown>; onError: (message: string) => void};

export function createChatFriendsModel() {
 const store = createStore<ChatFriendsState>(() => ({tab: 'all', query: '', busy: false}));

 /** Общий ход действия: занятость, обновление снапшота, результат и ошибка сервера. */
 const run = async <T>(action: () => Promise<T>, {refresh, onError}: FriendsContext, done?: (result: T) => void) => {
  store.setState({busy: true});
  try {
   const result = await action();
   await refresh();
   done?.(result);
  } catch (reason) {
   onError((reason as Error).message);
  } finally {
   store.setState({busy: false});
  }
 };

 const actions = {
  setTab(tab: FriendTab) {
   store.setState({tab});
  },
  setQuery(query: string) {
   store.setState({query});
  },
  request({userId, ...context}: FriendsContext & {userId: string}) {
   return run(() => friendService.request({user: userId}), context);
  },
  accept({friendId, ...context}: FriendsContext & {friendId: string}) {
   return run(() => friendService.accept(friendId), context);
  },
  /** Отказ и отмена заявки — одно удаление записи; имя действия говорит о смысле клика. */
  decline({friendId, ...context}: FriendsContext & {friendId: string}) {
   return run(() => friendService.remove(friendId), context);
  },
  remove({friendId, ...context}: FriendsContext & {friendId: string}) {
   return run(() => friendService.remove(friendId), context);
  },
  /** Переписка открывается сразу после создания диалога: страница сама решает, куда перейти. */
  startDialog({
   user,
   onDialog,
   ...context
  }: FriendsContext & {user: {id: string; name: string}; onDialog: (id: string) => void}) {
   return run(
    () => conversationService.createDialog<Dialog>({members: [user.id], name: user.name}),
    context,
    dialog => onDialog(dialog.id)
   );
  }
 };

 return {store, actions};
}
