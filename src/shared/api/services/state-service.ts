import {api} from '../api';
import type {ChatState} from '@/shared/types';
import {StaleChatState} from '../transport';

/** Снапшот состояния приложения: не принадлежит ни одной сущности, поэтому лежит в shared. */
export const stateService = {
 async load<T = ChatState>(payload?: Record<string, unknown>) {
  try {
   return await api.state.load<T>(payload);
  } catch (error) {
   if (!(error instanceof StaleChatState) || error.kind !== 'order') throw error;
   return api.state.load<T>(payload);
  }
 }
};
