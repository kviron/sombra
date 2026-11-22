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

export function UserActionsProvider({value, children}: {value: UserActionsValue; children: ReactNode}) {
 return <UserActionsContext.Provider value={value}>{children}</UserActionsContext.Provider>;
}

export function useUserActions() {
 return useContext(UserActionsContext);
}
