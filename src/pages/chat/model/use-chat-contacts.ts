import {useRef} from 'react';
import {toast} from 'sonner';
import {friendService} from '@/entities/user';
import type {FriendStatus} from '@/shared/lib/user-actions';
import type {ChatState} from '@/shared/types';
import {chatSnapshotActions, chatSnapshotStore} from './chat-state';
import {canRequestFriend, friendRecord, friendStatus} from './chat-rules';

/**
 * Дружба со страницы: статус, заявка, принятие и удаление.
 * Личные сообщения открывает навигация, профиль — панели, поэтому здесь только эти действия.
 */
export function useChatContacts(state: ChatState | null) {
 const pending = useRef(new Set<string>());

 /** Заявка отправляется один раз: повторное нажатие ждёт ответа сервера. */
 async function request(id: string) {
  if (!canRequestFriend(state, id) || pending.current.has(id)) return;
  pending.current.add(id);
  try {
   await friendService.request({user: id});
   await chatSnapshotActions.refresh();
   toast.success('Заявка в друзья отправлена');
  } catch (reason) {
   toast.error((reason as Error).message);
  } finally {
   pending.current.delete(id);
  }
 }

 async function accept(id: string) {
  const snapshot = chatSnapshotStore.getState().snapshot;
  const friend = snapshot?.friends.find(item => item.from === id && item.to === snapshot.me.id);
  if (!friend) return;
  try {
   await friendService.accept(friend.id);
   await chatSnapshotActions.refresh();
   toast.success('Заявка принята');
  } catch (reason) {
   toast.error((reason as Error).message);
  }
 }

 async function remove(id: string) {
  const friend = friendRecord(chatSnapshotStore.getState().snapshot, id);
  if (!friend) return;
  try {
   await friendService.remove(friend.id);
   await chatSnapshotActions.refresh();
  } catch (reason) {
   toast.error((reason as Error).message);
  }
 }

 return {
  status: (id: string): FriendStatus => friendStatus(state, id),
  request,
  accept,
  remove
 };
}

export type ChatContactsModel = ReturnType<typeof useChatContacts>;
