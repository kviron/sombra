import {createStore} from 'zustand/vanilla';

export type ForwardPickerState = {query: string};

const initialState: ForwardPickerState = {query: ''};

/** Черновик поиска в окне пересылки: создаётся на открытое окно. */
export function createForwardPickerModel() {
 const store = createStore<ForwardPickerState>(() => initialState);
 const actions = {
  setQuery(query: string) {
   store.setState({query});
  }
 };
 return {store, actions};
}

export type ForwardPickerModel = ReturnType<typeof createForwardPickerModel>;
