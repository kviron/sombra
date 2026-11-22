import {api} from '@/shared/api';
import type {SessionDto, User} from '@/shared/api/backend';

/** Профиль, устройства и сигнал «печатает» текущего пользователя. */
export const userService = {
 me: <T = {user: User}>(payload?: Record<string, unknown>) => api.auth.me<T>(payload),
 updateProfile: (payload: Record<string, unknown>) => api.user.updateProfile(payload),
 setCover: <T = {user: User}>(payload: Record<string, unknown>) => api.user.setCover<T>(payload),
 setDecoration: <T = {user: User}>(payload: Record<string, unknown>) => api.user.setDecoration<T>(payload),
 sessions: <T = SessionDto[]>(payload?: Record<string, unknown>) => api.user.sessions<T>(payload),
 revokeSession: (id: string) => api.user.revokeSession({session_id: id}),
 logoutAll: () => api.auth.logoutAll(),
 setTyping: (payload: Record<string, unknown>) => api.user.setTyping(payload)
};
