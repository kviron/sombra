// История канала: страницы старых сообщений, которых нет в снапшоте.
// Хранилище модульное, как и остальные модели страницы: чат в окне один.
import {createStore} from 'zustand/vanilla';
import {messageService} from '@/entities/message';
import type {ChatMessage, MessagesPage} from '@/shared/types';
import {canLoadOlder, historyLimit, isHistoryCursorInvalid, prependHistoryPage} from './chat-history-rules';

export type ChatHistoryState = {
 pages: Record<string, ChatMessage[]>;
 nextBefore: Record<string, string | null>;
 hasMore: Record<string, boolean>;
 loading: Record<string, boolean>;
 errors: Record<string, string>;
};

const initialState: ChatHistoryState = {pages: {}, nextBefore: {}, hasMore: {}, loading: {}, errors: {}};

export const chatHistoryStore = createStore<ChatHistoryState>(() => initialState);

/** Поколение истории: ответ, начатый до смены аккаунта, не должен попасть в новый сеанс. */
let generation = 0;

/** Грузилась ли страница канала: пустой `nextBefore` — ещё нет, `null` — истории больше нет. */
const pageLoaded = (state: ChatHistoryState, channel: string) =>
 Object.prototype.hasOwnProperty.call(state.nextBefore, channel);

function withoutKey<T>(record: Record<string, T>, key: string) {
 const next = {...record};
 delete next[key];
 return next;
}

/** Причина ошибки: сервер обычно отдаёт строку, но причиной может быть что угодно. */
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error || ''));

export const chatHistoryActions = {
 /** Смена аккаунта и размонтирование: поздние ответы отбрасываются, страницы очищаются. */
 resetAll() {
  generation++;
  chatHistoryStore.setState(initialState, true);
 },
 /**
  * Догрузка страницы старых сообщений. `before` — `nextBefore` прошлой страницы:
  * без него сервер отдаёт свежий срез, который совпадёт со снапшотом и схлопнется по id.
  */
 async loadOlder(channel: string) {
  if (!channel) return;
  const state = chatHistoryStore.getState();
  const loaded = pageLoaded(state, channel);
  if (!canLoadOlder({loading: !!state.loading[channel], loaded, hasMore: state.hasMore[channel] === true})) return;
  const started = generation;
  const before = loaded ? state.nextBefore[channel] || undefined : undefined;
  chatHistoryStore.setState(current => ({
   loading: {...current.loading, [channel]: true},
   errors: {...current.errors, [channel]: ''}
  }));
  try {
   let page: MessagesPage;
   try {
    page = await messageService.page({channel, ...(before ? {before} : {}), limit: historyLimit()});
   } catch (error) {
    if (!isHistoryCursorInvalid(error)) throw error;
    // Курсор устарел (сообщение удалили): страница канала начинается заново, без before.
    chatHistoryStore.setState(current => ({
     pages: {...current.pages, [channel]: []},
     nextBefore: withoutKey(current.nextBefore, channel)
    }));
    page = await messageService.page({channel, limit: historyLimit()});
   }
   if (started !== generation) return;
   chatHistoryStore.setState(current => ({
    pages: {...current.pages, [channel]: prependHistoryPage(current.pages[channel] || [], page.messages || [])},
    nextBefore: {...current.nextBefore, [channel]: page.nextBefore ?? null},
    hasMore: {...current.hasMore, [channel]: page.hasMore === true},
    loading: {...current.loading, [channel]: false},
    errors: {...current.errors, [channel]: ''}
   }));
  } catch (error) {
   if (started !== generation) return;
   // Уже загруженные страницы остаются: ошибка касается только следующей.
   chatHistoryStore.setState(current => ({
    loading: {...current.loading, [channel]: false},
    errors: {...current.errors, [channel]: errorText(error) || 'Неизвестная ошибка'}
   }));
  }
 }
};
