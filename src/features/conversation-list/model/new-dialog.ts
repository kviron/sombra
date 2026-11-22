import {createStore} from 'zustand/vanilla';
import {conversationService} from '@/entities/conversation';
import type {ChatState, Dialog} from '@/shared/types';
import {
 NEW_DIALOG_MEMBER_LIMIT,
 commonMemberIds,
 dialogPeople,
 friendIds,
 newDialogPayload,
 selectedPeople,
 toggleSelected
} from './new-dialog-rules';

export type NewDialogState = {
 query: string;
 selected: string[];
 name: string;
 busy: boolean;
 error: string;
 created: Dialog | null;
};

const initialState: NewDialogState = {
 query: '',
 selected: [],
 name: '',
 busy: false,
 error: '',
 created: null
};

/**
 * Хранилище черновика нового чата: создаётся на открытое окно, поэтому выбор и имя
 * не переживают закрытие и не мешают следующему диалогу.
 */
export function createNewDialogModel() {
 const store = createStore<NewDialogState>(() => initialState);
 let submitting = false;

 const actions = {
  setQuery(query: string) {
   store.setState({query});
  },
  setName(name: string) {
   store.setState({name});
  },
  /** Выбор ограничен лимитом; ошибка прошлой попытки сбрасывается. */
  toggle(userId: string) {
   const {busy, created} = store.getState();
   if (busy || created) return;
   store.setState(current => ({selected: toggleSelected(current.selected, userId), error: ''}));
  },
  /** Пока идёт создание, окно не закрывается: запрос уже ушёл на сервер. */
  isSubmitting() {
   return submitting;
  },

  /** Созданный чат переиспользуется: повтор обновления не создаёт второй. */
  async submit({
   state,
   refresh,
   onCreated
  }: {
   state: ChatState;
   refresh: () => Promise<unknown>;
   onCreated: (dialog: Dialog) => void;
  }) {
   const {selected, name, created} = store.getState();
   if (submitting || selected.length < 1 || selected.length > NEW_DIALOG_MEMBER_LIMIT) return;
   submitting = true;
   store.setState({busy: true, error: ''});
   try {
    const people = dialogPeople(state, friendIds(state), commonMemberIds(state));
    const users = selectedPeople(people, selected);
    const result = created ?? (await conversationService.createDialog<Dialog>(newDialogPayload(selected, users, name)));
    store.setState({created: result});
    await refresh();
    onCreated(result);
   } catch (cause) {
    store.setState({error: cause instanceof Error ? cause.message : 'Не удалось создать чат. Попробуйте ещё раз.'});
   } finally {
    submitting = false;
    store.setState({busy: false});
   }
  }
 };

 return {store, actions};
}

export type NewDialogModel = ReturnType<typeof createNewDialogModel>;
