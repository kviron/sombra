import {useState} from 'react';
export function useChatDraft(destination: string) {
 const [drafts, setDrafts] = useState<Record<string, string>>({});
 const draft = drafts[destination] || '';
 const setDraft = (text: string) => setDrafts(previous => ({...previous, [destination]: text}));
 const clearSent = (id: string, sent: string) =>
  setDrafts(previous => (previous[id] === sent ? {...previous, [id]: ''} : previous));
 return {draft, setDraft, clearSent};
}
