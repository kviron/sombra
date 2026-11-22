// Чистые правила списка друзей: вкладки, поиск, строки и подписи.
// Файл импортирует только типы: так его читает node --experimental-strip-types.
import type {Friend, User} from '@/shared/types';

export type FriendTab = 'all' | 'pending' | 'add';

export const friendTabs: readonly {id: FriendTab; label: string}[] = [
 {id: 'all', label: 'Все друзья'},
 {id: 'pending', label: 'Заявки'},
 {id: 'add', label: 'Добавить друга'}
];

/** Запись о дружбе в любом направлении: направление нужно подписи, а не поиску. */
export function friendOf(friends: readonly Friend[], me: string, id: string) {
 return friends.find(friend => (friend.from === id && friend.to === me) || (friend.to === id && friend.from === me));
}

export function matchesFriendName(user: User, query: string) {
 return user.name.toLowerCase().includes(query.toLowerCase());
}

type TabArgs = {users: readonly User[]; friends: readonly Friend[]; me: string; tab: FriendTab; query: string};

/** Люди вкладки: друзья, заявки (входящие и исходящие) или ещё не знакомые. */
export function friendTabUsers({users, friends, me, tab, query}: TabArgs) {
 return users
  .filter(user => !user.bot && user.id !== me && matchesFriendName(user, query))
  .filter(user => {
   const friend = friendOf(friends, me, user.id);
   return tab === 'add' ? !friend : tab === 'pending' ? friend && !friend.accepted : friend?.accepted;
  });
}

/** Что показать под именем: направление заявки важнее описания профиля. */
export function friendNote(friend: Friend | undefined, me: string, bio: string) {
 if (friend && !friend.accepted) return friend.from === me ? 'Заявка отправлена' : 'Хочет добавить вас в друзья';
 return bio || 'Пользователь Sombra';
}

export type FriendRowKind = 'add' | 'friend' | 'request';

/** Какие кнопки у строки: заявка, переписка с удалением или ответ на заявку. */
export function friendRowKind(friend: Friend | undefined): FriendRowKind {
 if (!friend) return 'add';
 return friend.accepted ? 'friend' : 'request';
}

/** Принять можно только входящую заявку: исходящую лишь отменяют. */
export const canAcceptFriend = (friend: Friend | undefined, me: string) =>
 !!friend && !friend.accepted && friend.to === me;

/** Счётчик у пункта «Заявки»: только входящие, которые ждут ответа. */
export const incomingFriendRequests = (friends: readonly Friend[], me: string) =>
 friends.filter(friend => !friend.accepted && friend.to === me).length;

export const friendsCountLabel = (tab: FriendTab) =>
 tab === 'pending' ? 'Ожидают ответа' : tab === 'add' ? 'Люди в Sombra' : 'Ваши друзья';

/** Пустая вкладка: заголовок, подсказка и только на «Все друзья» — кнопка перехода. */
export function friendsEmptyText(tab: FriendTab) {
 if (tab === 'pending')
  return {title: 'Новых заявок пока нет', note: 'Попробуйте поискать по имени или загляните позже.', add: false};
 if (tab === 'add')
  return {title: 'Никого не нашли', note: 'Попробуйте поискать по имени или загляните позже.', add: false};
 return {
  title: 'Здесь будут ваши друзья',
  note: 'Добавьте знакомых, чтобы быстро начинать разговор.',
  add: true
 };
}
