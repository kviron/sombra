import {useState} from 'react';
import {useStore} from 'zustand';
import {createStore} from 'zustand/vanilla';

/** Синхронное чтение не даёт двум submit одного события забрать один черновик. */
export function useChatDraft(destination: string) {
 const [store] = useState(() => createStore<Record<string, string>>(() => ({})));
 const draft = useStore(store, drafts => drafts[destination] || '');
 const getDraft = () => store.getState()[destination] || '';
 const setDraft = (text: string) => {
  if (getDraft() !== text) store.setState({[destination]: text});
 };
 const clearSent = (id: string, sent: string) => {
  if (sent && store.getState()[id] === sent) store.setState({[id]: ''});
 };
 return {draft, getDraft, setDraft, clearSent};
}
