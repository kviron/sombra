import {createStore} from 'zustand/vanilla';
import {conversationService} from '@/entities/conversation';
import type {ChatState, Dialog} from '@/shared/types';
import type {MemberSearchResult} from './conversation-info-rules';

export type ConversationInfoState = {
 editing: boolean;
 name: string;
 image: string;
 revision: number;
 busy: boolean;
 error: string;
 crop: File | undefined;
 memberQuery: string;
 memberResult: MemberSearchResult | undefined;
};

const initialState: ConversationInfoState = {
 editing: false,
 name: '',
 image: '',
 revision: 0,
 busy: false,
 error: '',
 crop: undefined,
 memberQuery: '',
 memberResult: undefined
};

export const conversationInfoStore = createStore<ConversationInfoState>(() => initialState);

export {
 canEditDialog,
 canSaveDialog,
 conversationScope,
 isConflict,
 isEmailQuery,
 matchesMember,
 memberSearchHint,
 memberSearchKey,
 visibleMemberIds
} from './conversation-info-rules';
export type {MemberSearchResult} from './conversation-info-rules';

export type SaveArgs = {
 chat: ChatState;
 editable: boolean;
 onSaved: ((owner: string, dialog: Dialog) => Promise<void>) | undefined;
 isAlive: () => boolean;
 isCurrentScope: () => boolean;
 currentDialog: () => Dialog | undefined;
};

export const conversationInfoActions = {
 reset() {
  conversationInfoStore.setState(initialState, true);
 },
 begin(dialog: Dialog) {
  conversationInfoStore.setState({
   editing: true,
   name: dialog.name,
   image: dialog.avatar || '',
   revision: dialog.revision || 0,
   error: '',
   crop: undefined
  });
 },
 cancel() {
  conversationInfoStore.setState({editing: false, crop: undefined, error: ''});
 },
 setName(name: string) {
  conversationInfoStore.setState({name});
 },
 setImage(image: string) {
  conversationInfoStore.setState({image});
 },
 setCrop(crop: File | undefined) {
  conversationInfoStore.setState({crop});
 },
 setMemberQuery(memberQuery: string) {
  conversationInfoStore.setState({memberQuery, memberResult: undefined});
 },
 setMemberResult(memberResult: MemberSearchResult | undefined) {
  conversationInfoStore.setState({memberResult});
 },

 /** Сохранение живёт здесь, а не в компоненте: проверки прав, ревизия и ошибки — правило продукта. */
 async save({chat, editable, onSaved, isAlive, isCurrentScope, currentDialog}: SaveArgs) {
  const {name, image, revision, busy} = conversationInfoStore.getState();
  const current = currentDialog();
  if (busy || !editable || !current || !onSaved) return false;
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 60) return false;

  const valid = () => isAlive() && isCurrentScope() && currentDialog()?.id === current.id;
  conversationInfoStore.setState({busy: true, error: ''});
  try {
   const result = await conversationService.update<Dialog>({
    dialog: current.id,
    revision,
    name: trimmed,
    avatar: image
   });
   if (!valid()) return false;
   if (result.id !== current.id || result.owner !== chat.me.id || !Number.isSafeInteger(result.revision)) {
    throw new Error('Не удалось подтвердить сохранение чата.');
   }
   await onSaved(chat.me.id, result);
   if (isAlive() && isCurrentScope()) conversationInfoStore.setState({editing: false, crop: undefined});
   return true;
  } catch (reason) {
   if (valid()) {
    conversationInfoStore.setState({
     error: reason instanceof Error ? reason.message : 'Не удалось сохранить чат. Черновик сохранён.',
     revision: currentDialog()?.revision || 0
    });
   }
   return false;
  } finally {
   if (isAlive() && isCurrentScope()) conversationInfoStore.setState({busy: false});
  }
 }
};
