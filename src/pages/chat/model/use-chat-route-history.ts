import {useStore} from 'zustand';
import {chatNavigationActions, chatNavigationStore} from './chat-navigation';

export function useChatRouteHistory() {
 const canGoBack = useStore(chatNavigationStore, state => state.previous.length > 0);
 const canGoForward = useStore(chatNavigationStore, state => state.next.length > 0);
 return {canGoBack, canGoForward, back: chatNavigationActions.back, forward: chatNavigationActions.forward};
}
