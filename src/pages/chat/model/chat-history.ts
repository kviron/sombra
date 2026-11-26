import {createStore} from 'zustand/vanilla';
import {messageService} from '@/entities/message';
import type {ChatMessage} from '@/shared/types';
import {chatSnapshotStore} from './chat-state';
import {HISTORY_PAGE_LIMIT_MAX, historyLimit, isHistoryCursorInvalid, prependHistoryPage} from './chat-history-rules';

type ChannelHistory = {
 messages: ChatMessage[];
 nextBefore: string | null;
 hasMore: boolean;
 loading: boolean;
 error: string;
};

export const chatHistoryStore = createStore<{account: string; channels: Record<string, ChannelHistory>}>(() => ({
 account: '',
 channels: {}
}));

const pending = new Map<string, Promise<void>>();
// Only the latest confirmed mutation of a row may publish a late read-back.
const mutations = new Map<string, symbol>();
const expiry = new Map<string, ReturnType<typeof setTimeout>>();
const inactiveLifetime = 5 * 60_000;

function cancelExpiry(channel: string) {
 clearTimeout(expiry.get(channel));
 expiry.delete(channel);
}

function forget(channel: string) {
 cancelExpiry(channel);
 pending.delete(channel);
 chatHistoryStore.setState(state => {
  const channels = {...state.channels};
  delete channels[channel];
  return {channels};
 });
}

function reset(account = '') {
 for (const timer of expiry.values()) clearTimeout(timer);
 expiry.clear();
 pending.clear();
 mutations.clear();
 chatHistoryStore.setState({account, channels: {}});
}

if (typeof window !== 'undefined') window.addEventListener('authchange', () => reset());

function update(channel: string, value: ChannelHistory) {
 chatHistoryStore.setState(state => ({channels: {...state.channels, [channel]: value}}));
}

function applyCachedMessage(channel: string, id: string, source: ChatMessage | undefined) {
 const history = chatHistoryStore.getState().channels[channel];
 if (!history) return;
 const messages: ChatMessage[] = [];
 for (const row of history.messages) {
  if (row.id === id) {
   if (source) messages.push(source);
  } else if (row.replyTo?.id === id) {
   const replyTo = source
    ? {
       id,
       author: source.user,
       text: Array.from(source.text ?? '')
        .slice(0, 200)
        .join('')
      }
    : {id};
   messages.push(row.replyTo.author === replyTo.author && row.replyTo.text === replyTo.text ? row : {...row, replyTo});
  } else messages.push(row);
 }
 if (messages.length === history.messages.length && messages.every((row, index) => row === history.messages[index]))
  return;
 const nextBefore = !source && history.nextBefore === id ? (messages[0]?.id ?? null) : history.nextBefore;
 update(channel, {...history, messages, nextBefore});
}

async function readBackMessage(channel: string, id: string, current: () => boolean) {
 const cached = chatHistoryStore.getState().channels[channel];
 const index = cached?.messages.findIndex(row => row.id === id) ?? -1;
 if (!cached || index < 0) return;
 // The immediately newer row anchors a one-message page, including on older servers.
 // If others deleted that anchor, use the next surviving one and widen the requested range.
 const limit = Math.min(HISTORY_PAGE_LIMIT_MAX, cached.messages.length - index);
 for (let distance = 1; distance <= limit && current(); distance++) {
  const before = cached.messages[index + distance]?.id;
  try {
   const page = await messageService.page({channel, before, limit: distance});
   if (current())
    applyCachedMessage(
     channel,
     id,
     page.messages.find(row => row.id === id)
    );
   return;
  } catch (error) {
   if (!before || distance === limit || !isHistoryCursorInvalid(error)) throw error;
  }
 }
}

export const chatHistoryActions = {
 retain(account: string, channel: string) {
  if (chatHistoryStore.getState().account !== account) reset(account);
  cancelExpiry(channel);
  return () => {
   if (chatHistoryStore.getState().account === account && chatHistoryStore.getState().channels[channel]) {
    cancelExpiry(channel);
    expiry.set(
     channel,
     setTimeout(() => forget(channel), inactiveLifetime)
    );
   }
  };
 },
 // The state snapshot already contains the latest page, in server cursor order.
 acceptRecent(channel: string, recent: ChatMessage[], truncated: boolean) {
  const previous = chatHistoryStore.getState().channels[channel];
  if (!truncated) {
   if (previous) forget(channel);
   return;
  }
  const first = recent[0]?.id;
  const overlap = first && previous ? previous.messages.findIndex(row => row.id === first) : -1;
  if (!previous || overlap < 0) {
   pending.delete(channel);
   update(channel, {messages: recent, nextBefore: first ?? null, hasMore: true, loading: false, error: ''});
   return;
  }
  if (
   previous.messages.length === overlap + recent.length &&
   recent.every((row, i) => previous.messages[overlap + i] === row)
  )
   return;
  update(channel, {...previous, messages: [...previous.messages.slice(0, overlap), ...recent]});
 },
 loadOlder(channel: string): Promise<void> {
  const existing = pending.get(channel);
  if (existing) return existing;
  const history = chatHistoryStore.getState().channels[channel];
  if (!history?.hasMore) return Promise.resolve();
  const before = history.nextBefore;
  const request = Promise.resolve().then(async () => {
   const current = () => pending.get(channel) === request;
   if (!current()) return;
   let restart = false;
   try {
    const fetchPage = (cursor: string | null) =>
     messageService.page({channel, ...(cursor ? {before: cursor} : {}), limit: historyLimit()});
    const page = await fetchPage(before).catch(error => {
     if (!before || !isHistoryCursorInvalid(error) || !current()) throw error;
     const repaired = chatHistoryStore.getState().channels[channel]?.nextBefore;
     if (repaired && repaired !== before) return fetchPage(repaired);
     restart = true;
     return fetchPage(null);
    });
    if (!current()) return;
    const latest = chatHistoryStore.getState().channels[channel];
    update(channel, {
     messages: prependHistoryPage(restart ? [] : latest.messages, page.messages),
     nextBefore: page.nextBefore ?? null,
     hasMore: page.hasMore && !!page.nextBefore && (restart || page.nextBefore !== before),
     loading: false,
     error: ''
    });
   } catch (error) {
    if (current())
     update(channel, {
      ...chatHistoryStore.getState().channels[channel],
      loading: false,
      error:
       error instanceof Error
        ? error.message || 'Не удалось загрузить историю'
        : String(error || 'Не удалось загрузить историю')
     });
   } finally {
    if (current()) pending.delete(channel);
   }
  });
  pending.set(channel, request);
  update(channel, {...history, loading: true, error: ''});
  return request;
 },
 // Mutations return only an acknowledgement. Edits can also change server-resolved mentions.
 async refreshMessage(account: string, message: ChatMessage, deleted: boolean, refresh: () => Promise<unknown>) {
  const {channel, id} = message;
  const scope = () =>
   chatHistoryStore.getState().account === account && chatSnapshotStore.getState().snapshot?.me.id === account;
  if (!scope()) return;
  const ticket = Symbol();
  mutations.set(id, ticket);
  const current = () => scope() && mutations.get(id) === ticket;
  try {
   if (deleted) {
    applyCachedMessage(channel, id, undefined);
    await refresh();
    return;
   }
   const recent = chatSnapshotStore.getState().snapshot?.messages.some(row => row.id === id);
   if (!recent) {
    await readBackMessage(channel, id, current);
    if (current()) await refresh();
   } else {
    await refresh();
    if (!current()) return;
    const source = chatSnapshotStore.getState().snapshot?.messages.find(row => row.id === id);
    if (source) applyCachedMessage(channel, id, source);
    else await readBackMessage(channel, id, current);
   }
  } finally {
   if (mutations.get(id) === ticket) mutations.delete(id);
  }
 },
 async findMessage(channel: string, id: string, current: () => boolean) {
  const visited = new Set<string | null>();
  while (current()) {
   const history = chatHistoryStore.getState().channels[channel];
   if (!history) return false;
   if (history.messages.some(row => row.id === id)) return true;
   if (!history.hasMore || visited.has(history.nextBefore)) return false;
   visited.add(history.nextBefore);
   await chatHistoryActions.loadOlder(channel);
   const error = chatHistoryStore.getState().channels[channel]?.error;
   if (error) throw new Error(error);
  }
  return false;
 }
};
