import {createContext, useContext, type ReactNode} from 'react';
import type {User} from '@/shared/types';

export type FriendStatus = 'self' | 'none' | 'outgoing' | 'incoming' | 'friends';

export type UserActionsValue = {
 me?: User;
 openProfile: (id: string) => void;
 messageUser: (id: string) => void;
 editOwnProfile: () => void;
 friendStatus: (id: string) => FriendStatus;
 addFriend: (id: string) => void;
 acceptFriend: (id: string) => void;
 removeFriend: (id: string) => void;
};

const UserActionsContext = createContext<UserActionsValue | null>(null);

const OpenProfileContext = createContext<UserActionsValue['openProfile'] | undefined>(undefined);

export function useOpenProfile() {
 return useContext(OpenProfileContext);
}

export function UserActionsProvider({value, children}: {value: UserActionsValue; children: ReactNode}) {
 return (
  <UserActionsContext.Provider value={value}>
   <OpenProfileContext.Provider value={value.openProfile}>{children}</OpenProfileContext.Provider>
  </UserActionsContext.Provider>
 );
}

export function useUserActions() {
 return useContext(UserActionsContext);
}
