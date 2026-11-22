import {api} from '@/shared/api';

/** Голосовая комната: вход, опрос сигнализации, выход и обмен сигналами WebRTC. */
export const voiceService = {
 join: <T = unknown>(payload: Record<string, unknown>) => api.voice.join<T>(payload),
 poll: <T = unknown>(payload: Record<string, unknown>) => api.voice.poll<T>(payload),
 leave: (payload: Record<string, unknown>) => api.voice.leave(payload),
 signal: (payload: Record<string, unknown>) => api.voice.signal(payload)
};
