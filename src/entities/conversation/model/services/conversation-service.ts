import {api} from '@/shared/api';
import type {ChatPreferences, Dialog, User} from '@/shared/api/backend';

/** Переписки: создание диалога, правка и поиск участников. */
export const conversationService = {
 createDialog: <T = Dialog>(payload: Record<string, unknown>) => api.conversation.createDialog<T>(payload),
 update: <T = Dialog>(payload: Record<string, unknown>) => api.conversation.update<T>(payload),
 setPreferences: <T = ChatPreferences>(payload: Record<string, unknown>) => api.conversation.setPreferences<T>(payload),
 searchMembers: <T = {users: User[]}>(payload: Record<string, unknown>) => api.conversation.searchMembers<T>(payload)
};
