import {useState} from 'react';
import {useStore} from 'zustand';
import {emptyDestinationsText, filterDestinations, type ForwardDestination} from './message-references-rules';
import {createForwardPickerModel} from './forward-picker';

/**
 * Единственное место, где живёт поиск назначения пересылки: запрос и отфильтрованный
 * список. Компонент получает готовые данные и колбэк.
 */
export function useForwardPicker(destinations: ForwardDestination[]) {
 const [model] = useState(() => createForwardPickerModel());
 const {query} = useStore(model.store);
 return {
  query,
  matches: filterDestinations(destinations, query),
  emptyText: emptyDestinationsText(query),
  actions: {setQuery: model.actions.setQuery}
 };
}

export type ForwardPickerDialogModel = ReturnType<typeof useForwardPicker>;
