import {api} from '@/shared/api';

/** Заявки в друзья: отправить, принять и удалить. */
export const friendService = {
 request: (payload: Record<string, unknown>) => api.friend.request(payload),
 accept: (id: string) => api.friend.accept({id}),
 remove: (id: string) => api.friend.remove({id})
};
