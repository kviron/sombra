import {api} from '@/shared/api';

type BotToken = {token?: string};

/** Боты: настройки владельца, доступ к инструментам и подключение. */
export const botService = {
 settings: <T = unknown>(payload: Record<string, unknown>) => api.bot.settings<T>(payload),
 updateSettings: <T = unknown>(payload: Record<string, unknown>) => api.bot.updateSettings<T>(payload),
 modelSettings: <T = unknown>(payload: Record<string, unknown>) => api.bot.modelSettings<T>(payload),
 updateModelSettings: <T = unknown>(payload: Record<string, unknown>) => api.bot.updateModelSettings<T>(payload),
 toolUsers: <T = unknown>(payload: Record<string, unknown>) => api.bot.toolUsers<T>(payload),
 setToolUsers: <T = unknown>(payload: Record<string, unknown>) => api.bot.setToolUsers<T>(payload),
 create: <T = BotToken>(payload: Record<string, unknown>) => api.bot.create<T>(payload),
 remove: (payload: Record<string, unknown>) => api.bot.remove(payload),
 removeFromGroup: (payload: Record<string, unknown>) => api.bot.removeFromGroup(payload),
 rotateToken: <T = BotToken>(payload: Record<string, unknown>) => api.bot.rotateToken<T>(payload)
};
