import {createStore} from 'zustand/vanilla';
import {messageService} from '@/entities/message';
import type {ChatMessage} from '@/shared/types';
import {actionError, canSubmit, removeForEveryone} from './message-action-rules';

export type MessageActionMode = 'edit' | 'delete';

export type MessageActionState = {
 text: string;
 forEveryone: boolean;
 busy: boolean;
 error: string;
};

const initialState: MessageActionState = {text: '', forEveryone: false, busy: false, error: ''};

export type SubmitArgs = {
 /** Автор или право удалять чужие сообщения: решает, доступно ли «для всех». */
 mayDeleteEveryone: boolean;
 refresh: () => Promise<unknown>;
 onClose: () => void;
};

/**
 * Хранилище черновика правки и подтверждения удаления: создаётся на открытое окно
 * сообщения, поэтому текст одного сообщения не попадает в другое.
 */
export function createMessageActionModel({mode, message}: {mode: MessageActionMode; message: ChatMessage}) {
 const store = createStore<MessageActionState>(() => ({...initialState, text: message.text || ''}));

 const actions = {
  setText(text: string) {
   store.setState({text});
  },
  setForEveryone(forEveryone: boolean) {
   store.setState({forEveryone});
  },
  /** Окно не закрывается, пока запрос в работе: иначе результат некуда показать. */
  close(open: boolean, onClose: () => void) {
   if (!open && !store.getState().busy) onClose();
  },

  /** Правка и удаление живут здесь: проверки и запрос — правило продукта, а не разметка. */
  async submit({mayDeleteEveryone, refresh, onClose}: SubmitArgs) {
   const {text, forEveryone, busy} = store.getState();
   if (!canSubmit(mode, busy, text, message.text)) return;
   store.setState({busy: true, error: ''});
   try {
    if (mode === 'edit') await messageService.update({message: message.id, text: text.trim()});
    else
     await messageService.remove({
      message: message.id,
      for_everyone: removeForEveryone(mayDeleteEveryone, forEveryone)
     });
    await refresh();
    onClose();
   } catch (reason) {
    store.setState({error: actionError(reason)});
   } finally {
    store.setState({busy: false});
   }
  }
 };

 return {store, actions};
}

export type MessageActionModel = ReturnType<typeof createMessageActionModel>;
