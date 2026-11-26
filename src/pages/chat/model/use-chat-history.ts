import {useCallback, useLayoutEffect, useMemo} from 'react';
import {useStore} from 'zustand';
import type {ChatMessage, ChatState} from '@/shared/types';
import {chatHistoryActions, chatHistoryStore} from './chat-history';
import {historyTruncated} from './chat-history-rules';

const NO_MESSAGES: ChatMessage[] = [];

export function useChatHistory({state, channel}: {state: ChatState | null; channel: string}) {
 const account = state?.me.id;
 const history = useStore(chatHistoryStore, cache => (cache.account === account ? cache.channels[channel] : undefined));
 const serverMessages = state?.messages;
 const recent = useMemo(
  () => serverMessages?.filter(row => row.channel === channel) ?? NO_MESSAGES,
  [serverMessages, channel]
 );
 const truncated = historyTruncated(state, channel);

 useLayoutEffect(() => {
  if (account && channel) return chatHistoryActions.retain(account, channel);
 }, [account, channel]);
 useLayoutEffect(() => {
  if (account && channel) chatHistoryActions.acceptRecent(channel, recent, truncated);
 }, [account, channel, recent, truncated]);

 const loadOlder = useCallback(() => {
  if (account && chatHistoryStore.getState().account === account) void chatHistoryActions.loadOlder(channel);
 }, [account, channel]);
 return {
  messages: history?.messages ?? NO_MESSAGES,
  hasMore: history?.hasMore ?? false,
  loading: history?.loading ?? false,
  error: history?.error ?? '',
  loadOlder
 };
}
