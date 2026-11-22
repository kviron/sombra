import {createStore} from 'zustand/vanilla';
import type {MessageReader} from './message-readers-rules';

export type MessageReadersState = {
 readers: MessageReader[] | null;
 error: string;
 attempt: number;
};

const initialState: MessageReadersState = {readers: null, error: '', attempt: 0};

/**
 * Хранилище списка просмотревших: создаётся на открытое окно сообщения, поэтому
 * просмотры одного сообщения не показываются у другого.
 */
export function createMessageReadersModel() {
 const store = createStore<MessageReadersState>(() => initialState);
 const actions = {
  /** Начало загрузки: прошлый список и ошибка больше не относятся к текущему запросу. */
  begin() {
   store.setState({readers: null, error: ''});
  },
  loaded(readers: MessageReader[]) {
   store.setState({readers});
  },
  failed(error: string) {
   store.setState({error});
  },
  retry() {
   store.setState(current => ({attempt: current.attempt + 1}));
  }
 };
 return {store, actions};
}

export type MessageReadersModel = ReturnType<typeof createMessageReadersModel>;
