// Связка истории с активным каналом: обрезанный канал один раз сам открывает страницу,
// дальше решают кнопка и прокрутка. Поколение аккаунта защищает от поздних ответов.
import {useCallback, useEffect, useRef} from 'react';
import {useStore} from 'zustand';
import type {ChatMessage, ChatState} from '@/shared/types';
import {chatHistoryActions, chatHistoryStore} from './chat-history';
import {historyTruncated} from './chat-history-rules';

type Options = {state: ChatState | null; channel: string};

const NO_MESSAGES: ChatMessage[] = [];

export function useChatHistory({state, channel}: Options) {
 const history = useStore(chatHistoryStore);
 const account = state?.me.id || '';
 const autoLoaded = useRef(new Set<string>());
 // Действие всегда попадает в текущий канал: старый обработчик не догрузит прошлый.
 const active = useRef(channel);
 active.current = channel;

 // Смена аккаунта или размонтирование: чужие страницы не должны пережить сеанс.
 useEffect(() => {
  autoLoaded.current = new Set();
  chatHistoryActions.resetAll();
  return () => {
   autoLoaded.current = new Set();
   chatHistoryActions.resetAll();
  };
 }, [account]);

 // Одна автодогрузка на канал: дальше прокрутка и кнопка, поэтому цикла нет.
 useEffect(() => {
  if (!account || !channel || !historyTruncated(state, channel)) return;
  const key = `${account}:${channel}`;
  if (autoLoaded.current.has(key)) return;
  autoLoaded.current.add(key);
  // Страница уже в памяти (возврат в канал): повторный запрос не нужен.
  if (Object.prototype.hasOwnProperty.call(chatHistoryStore.getState().nextBefore, channel)) return;
  void chatHistoryActions.loadOlder(channel);
 }, [account, channel, state]);

 const loadOlder = useCallback(() => {
  const target = active.current;
  if (target) void chatHistoryActions.loadOlder(target);
 }, []);

 return {
  messages: history.pages[channel] || NO_MESSAGES,
  hasMore: history.hasMore[channel] === true,
  loading: history.loading[channel] === true,
  error: history.errors[channel] || '',
  loadOlder
 };
}
