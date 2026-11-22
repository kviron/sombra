import {useState} from 'react';
import {useStore} from 'zustand';
import type {ChatMessage} from '@/shared/types';
import {
 canSaveEdit,
 deleteDescription,
 mayDeleteForEveryone,
 removeForEveryone,
 textTooLong
} from './message-action-rules';
import {createMessageActionModel, type MessageActionMode} from './message-action';

type Options = {
 mode: MessageActionMode;
 message: ChatMessage;
 author: boolean;
 canDeleteEveryone: boolean;
 refresh: () => Promise<unknown>;
 onClose: () => void;
};

/**
 * Единственное место, где живёт логика окна сообщения: черновик правки, флаг «для всех»,
 * запрос и ошибка. Компонент получает готовые значения и колбэки.
 */
export function useMessageAction({mode, message, author, canDeleteEveryone, refresh, onClose}: Options) {
 const [model] = useState(() => createMessageActionModel({mode, message}));
 const stored = useStore(model.store);
 const {actions} = model;
 const mayDeleteEveryone = mayDeleteForEveryone(author, canDeleteEveryone);
 const removeAll = removeForEveryone(mayDeleteEveryone, stored.forEveryone);

 return {
  text: stored.text,
  forEveryone: stored.forEveryone,
  busy: stored.busy,
  error: stored.error,
  mayDeleteEveryone,
  removeForEveryone: removeAll,
  deleteDescription: deleteDescription(removeAll),
  tooLong: textTooLong(stored.text),
  canSave: canSaveEdit(stored.text, message.text),
  actions: {
   setText: actions.setText,
   setForEveryone: actions.setForEveryone,
   close: (open: boolean) => actions.close(open, onClose),
   submit: () => void actions.submit({mayDeleteEveryone, refresh, onClose})
  }
 };
}

export type MessageActionDialogModel = ReturnType<typeof useMessageAction>;
