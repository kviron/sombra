import {api} from '../api';
import type {ChatState} from '../backend';

/** Снапшот состояния приложения: не принадлежит ни одной сущности, поэтому лежит в shared. */
export const stateService = {
 load: <T = ChatState>(payload?: Record<string, unknown>) => api.state.load<T>(payload)
};
