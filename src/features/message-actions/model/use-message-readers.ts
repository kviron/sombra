import {useEffect, useRef, useState} from 'react';
import {useStore} from 'zustand';
import {messageService} from '@/entities/message';
import type {ChatState, ChatMessage} from '@/shared/types';
import {
 readersAvailable,
 readersError,
 seenAtIso,
 seenAtLabel,
 withoutAuthor,
 type MessageReader
} from './message-readers-rules';
import {createMessageReadersModel} from './message-readers';

type Options = {state: ChatState; message: ChatMessage; onClose: () => void};

/**
 * Единственное место, где живёт логика просмотров: доступность, загрузка, повтор и
 * готовые строки списка. Компонент получает данные и колбэк.
 */
export function useMessageReaders({state, message, onClose}: Options) {
 const [model] = useState(() => createMessageReadersModel());
 const {actions} = model;
 const stored = useStore(model.store);
 const close = useRef(onClose);
 close.current = onClose;
 const owner = state.me.id;
 const {channel, id, user} = message;
 const supported = state.readReceiptsSupported;

 // Ответ прошлого запроса не должен попасть в новый: каждому эффекту свой флаг жизни.
 useEffect(() => {
  let current = true;
  actions.begin();
  if (!readersAvailable(supported, user, owner)) {
   close.current();
   return;
  }
  const auth = () => {
   current = false;
   actions.begin();
   close.current();
  };
  window.addEventListener('authchange', auth);
  void messageService
   .readers<{readers: MessageReader[]}>({message: id})
   .then(result => {
    if (current) actions.loaded(withoutAuthor(result.readers, owner));
   })
   .catch(reason => {
    if (current) actions.failed(readersError(reason));
   });
  return () => {
   current = false;
   window.removeEventListener('authchange', auth);
  };
 }, [actions, owner, channel, id, stored.attempt, supported, user]);

 const rows = (stored.readers ?? []).map(reader => {
  const person = state.users.find(item => item.id === reader.user);
  return {
   id: reader.user,
   user: person || {id: reader.user, name: 'Пользователь'},
   name: person?.name || 'Пользователь',
   decoration: person?.decorations?.avatar,
   iso: seenAtIso(reader.seenAt),
   label: seenAtLabel(reader.seenAt)
  };
 });

 return {
  readers: stored.readers,
  error: stored.error,
  rows,
  actions: {retry: actions.retry}
 };
}

export type MessageReadersDialogModel = ReturnType<typeof useMessageReaders>;
