import {useState} from 'react';
import {useStore} from 'zustand';
import type {ChatState, Dialog, User} from '@/shared/types';
import {
 canSubmitSelection,
 commonMemberIds,
 dialogPeople,
 emptyPeopleText,
 errorText,
 friendIds,
 limitNote,
 memberUnavailable,
 selectedPeople,
 submitLabel,
 visiblePeople
} from './new-dialog-rules';
import {createNewDialogModel} from './new-dialog';

type Options = {
 state: ChatState;
 refresh: () => Promise<unknown>;
 onCreated: (dialog: Dialog) => void;
};

/**
 * Единственное место, где живёт логика нового чата: кандидаты, поиск, выбор и создание.
 * Компонент получает готовые списки, подписи и колбэки.
 */
export function useNewDialog({state, refresh, onCreated}: Options) {
 const [model] = useState(() => createNewDialogModel());
 const stored = useStore(model.store);
 const {actions} = model;
 const friends = friendIds(state);
 const people = dialogPeople(state, friends, commonMemberIds(state));
 const chosen = selectedPeople(people, stored.selected);
 const locked = stored.busy || !!stored.created;

 return {
  query: stored.query,
  selected: stored.selected,
  name: stored.name,
  busy: stored.busy,
  error: stored.error,
  created: stored.created,
  selectedUsers: chosen,
  people: visiblePeople(people, friends, stored.query),
  locked,
  canSubmit: canSubmitSelection(stored.selected),
  limitNote: limitNote(stored.selected.length),
  emptyText: emptyPeopleText(stored.query),
  errorText: errorText(!!stored.created, stored.error),
  submitLabel: submitLabel({
   busy: stored.busy,
   created: !!stored.created,
   error: stored.error,
   count: stored.selected.length
  }),
  isFriend: (id: string) => friends.has(id),
  unavailable: (user: User) => memberUnavailable(user, stored.selected, chosen, locked),
  isSubmitting: () => actions.isSubmitting(),
  actions: {
   setQuery: actions.setQuery,
   setName: actions.setName,
   toggle: actions.toggle,
   submit: () => void actions.submit({state, refresh, onCreated})
  }
 };
}

export type NewDialogModel = ReturnType<typeof useNewDialog>;
