import {useState} from 'react';
import {useStore} from 'zustand';
import type {ChatState} from '@/shared/types';
import {createChatFriendsModel} from './chat-friends';
import {
 canAcceptFriend,
 friendNote,
 friendOf,
 friendRowKind,
 friendTabUsers,
 friendsCountLabel,
 friendsEmptyText,
 friendTabs,
 incomingFriendRequests
} from './chat-friends-rules';

type Options = {
 state: ChatState;
 refresh: () => Promise<unknown>;
 onError: (message: string) => void;
 onDialog: (id: string) => void;
};

/**
 * Список друзей: вкладка, поиск, строки и действия живут в модели.
 * Компонент получает готовые строки и колбэки.
 */
export function useChatFriends({state, refresh, onError, onDialog}: Options) {
 const [model] = useState(createChatFriendsModel);
 const {tab, query, busy} = useStore(model.store);
 const friends = state.friends || [];
 const me = state.me.id;
 const users = friendTabUsers({users: state.users, friends, me, tab, query});

 return {
  tabs: friendTabs,
  tab,
  query,
  busy,
  count: friendsCountLabel(tab),
  incoming: incomingFriendRequests(friends, me),
  empty: users.length ? undefined : friendsEmptyText(tab),
  rows: users.map(user => {
   const friend = friendOf(friends, me, user.id);
   return {
    user,
    note: friendNote(friend, me, user.bio),
    kind: friendRowKind(friend),
    accept: canAcceptFriend(friend, me),
    friendId: friend?.id || ''
   };
  }),
  actions: {
   setTab: model.actions.setTab,
   setQuery: model.actions.setQuery,
   request: (userId: string) => void model.actions.request({userId, refresh, onError}),
   accept: (friendId: string) => void model.actions.accept({friendId, refresh, onError}),
   decline: (friendId: string) => void model.actions.decline({friendId, refresh, onError}),
   remove: (friendId: string) => void model.actions.remove({friendId, refresh, onError}),
   startDialog: (user: {id: string; name: string}) => void model.actions.startDialog({user, onDialog, refresh, onError})
  }
 };
}
