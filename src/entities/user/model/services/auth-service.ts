import {api} from '@/shared/api';

/** Вход и выход: компоненты не ходят к транспорту напрямую. */
export const authService = {
 login: (payload: Record<string, unknown> = {}) => api.auth.login(payload),
 register: (payload: Record<string, unknown> = {}) => api.auth.register(payload),
 logout: () => api.auth.logout(),
};
