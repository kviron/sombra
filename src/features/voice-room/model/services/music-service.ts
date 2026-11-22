import {api} from '@/shared/api';

/** Музыка комнаты: снапшот, файл трека, команда и потоковые куски. */
export const musicService = {
 state: <T = unknown>(payload: Record<string, unknown>) => api.music.state<T>(payload),
 file: <T = {mime: string; base64: string}>(payload: Record<string, unknown>) => api.music.file<T>(payload),
 command: <T = unknown>(payload: Record<string, unknown>) => api.music.command<T>(payload),
 streamChunk: <T = unknown>(payload: Record<string, unknown>) => api.music.streamChunk<T>(payload)
};
