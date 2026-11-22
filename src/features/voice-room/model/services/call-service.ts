import {api} from '@/shared/api';
import type {DialogCall} from '@/shared/types';

/** Звонки в переписке: начать, отменить и отклонить. */
export const callService = {
 start: <T = DialogCall>(payload: Record<string, unknown>) => api.call.start<T>(payload),
 cancel: (payload: Record<string, unknown>) => api.call.cancel(payload),
 decline: (payload: Record<string, unknown>) => api.call.decline(payload)
};
