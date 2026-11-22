import type {ReactElement, ReactNode} from 'react';
import {Check, Clock3, MessageCircle, Pencil, UserMinus, UserPlus, UserRound, type LucideIcon} from 'lucide-react';
import {EntityContextMenu} from '@/shared/ui/entity-context-menu';
import type {UserIdentity} from '@/shared/ui/user-avatar';
import {useUserActions, type FriendStatus} from '@/shared/lib/user-actions';

export type UserMenuAction = {
 label: string;
 icon?: LucideIcon;
 onSelect: () => void;
 disabled?: boolean;
 separator?: boolean;
};

function friendAction(status: FriendStatus, actions: ReturnType<typeof useUserActions>, id: string): UserMenuAction[] {
 if (!actions || status === 'self') return [];
 if (status === 'outgoing')
  return [{label: 'Заявка отправлена', icon: Clock3, onSelect: () => {}, disabled: true, separator: true}];
 if (status === 'incoming')
  return [{label: 'Принять заявку', icon: Check, onSelect: () => actions.acceptFriend(id), separator: true}];
 if (status === 'friends')
  return [{label: 'Удалить из друзей', icon: UserMinus, onSelect: () => actions.removeFriend(id), separator: true}];
 return [{label: 'Добавить в друзья', icon: UserPlus, onSelect: () => actions.addFriend(id), separator: true}];
}

/**
 * Right-click menu shared by every place a person appears: members, direct
 * messages, voice rooms and message authors. Controlled by UserActionsProvider.
 */
export function UserContextMenu({
 user,
 children,
 controls,
 actions = []
}: {
 user: UserIdentity;
 children: ReactElement;
 controls?: ReactNode;
 actions?: UserMenuAction[];
}) {
 const context = useUserActions();
 if (!context) return children;
 const status = context.friendStatus(user.id);
 const profileItem: UserMenuAction = {label: 'Профиль', icon: UserRound, onSelect: () => context.openProfile(user.id)};
 const messageItem: UserMenuAction =
  status === 'self'
   ? {label: 'Изменить профиль', icon: Pencil, onSelect: context.editOwnProfile}
   : {label: 'Личное сообщение', icon: MessageCircle, onSelect: () => context.messageUser(user.id)};
 return (
  <EntityContextMenu
   controls={controls}
   actions={[
    profileItem,
    messageItem,
    ...('bot' in user && user.bot ? [] : friendAction(status, context, user.id)),
    ...actions
   ]}
  >
   {children}
  </EntityContextMenu>
 );
}
