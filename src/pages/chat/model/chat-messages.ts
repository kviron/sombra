// Транскрипт и черновики страницы: поиск, переход к сообщению, ответ и пересылка, вложения,
// а также исходящие до ответа сервера (оптимистичная отправка).
// Черновики адресуются ключом «аккаунт + переписка», поэтому хранилище модульное: страница одна.
import {createStore} from 'zustand/vanilla';
import type {VerifiedMention} from '@/entities/message';
import type {AttachmentDraft, ChatMessage} from '@/shared/types';
import {matchesServerMessage, outgoingText} from './chat-rules';

export type ForwardDraft = {message: ChatMessage; comment: string};

/** Что именно отправляем: хватает для повтора без обращения к полю ввода. */
export type OutgoingDraft = {
 channel: string;
 user: string;
 text: string;
 mentions: VerifiedMention[];
 attachment?: AttachmentDraft;
 replyTo?: string;
 time: number;
};

export type OutgoingEntry = {status: 'sending' | 'failed'; draft: OutgoingDraft; error?: string};

export type ChatMessagesState = {
 search: string;
 jumpMessage: string;
 jumpEpoch: number;
 jumpOwner: string;
 pendingJump: {channel: string; message: string} | null;
 replyDrafts: Record<string, ChatMessage | undefined>;
 forwardDrafts: Record<string, ForwardDraft | undefined>;
 forwardPicker: {owner: string; message: ChatMessage} | undefined;
 attachments: Record<string, AttachmentDraft | undefined>;
 readingAttachments: Record<string, boolean>;
 outbox: Record<string, OutgoingEntry>;
};

const initialState: ChatMessagesState = {
 search: '',
 jumpMessage: '',
 jumpEpoch: 0,
 jumpOwner: '',
 pendingJump: null,
 replyDrafts: {},
 forwardDrafts: {},
 forwardPicker: undefined,
 attachments: {},
 readingAttachments: {},
 outbox: {}
};

export const chatMessagesStore = createStore<ChatMessagesState>(() => initialState);

export const chatMessagesActions = {
 reset() {
  chatMessagesStore.setState(initialState, true);
 },
 setSearch(search: string) {
  chatMessagesStore.setState({search});
 },
 clearSearch() {
  chatMessagesStore.setState({search: ''});
 },
 /** Переход к сообщению помнит аккаунт: подсветка не должна переезжать в чужой сеанс. */
 jumpTo(message: string, owner: string) {
  chatMessagesStore.setState(current => ({jumpMessage: message, jumpOwner: owner, jumpEpoch: current.jumpEpoch + 1}));
 },
 setJump(message: string) {
  chatMessagesStore.setState(current => ({jumpMessage: message, jumpEpoch: current.jumpEpoch + 1}));
 },
 /** Подсветка перехода гаснет сама: цель перехода больше не нужна. */
 clearJump() {
  chatMessagesStore.setState({jumpMessage: ''});
 },
 /** Уведомление просит открыть сообщение, когда переписка уже выбрана. */
 setPendingJump(pendingJump: {channel: string; message: string}) {
  chatMessagesStore.setState({pendingJump});
 },
 /** Смена переписки закрывает поиск и один раз применяет отложенный переход из уведомления. */
 onChannelChange(channel: string) {
  chatMessagesStore.setState(current => ({
   search: '',
   jumpMessage: current.pendingJump && current.pendingJump.channel === channel ? current.pendingJump.message : '',
   pendingJump: null
  }));
 },
 startReply(key: string, message: ChatMessage) {
  chatMessagesStore.setState(current => ({replyDrafts: {...current.replyDrafts, [key]: message}}));
 },
 /** Отмена сверяет черновик: поздний ответ не должен стереть уже выбранный другой. */
 cancelReply(key: string, sent?: ChatMessage) {
  chatMessagesStore.setState(current =>
   sent && current.replyDrafts[key] !== sent ? current : {replyDrafts: {...current.replyDrafts, [key]: undefined}}
  );
 },
 openForwardPicker(owner: string, message: ChatMessage) {
  chatMessagesStore.setState({forwardPicker: {owner, message}});
 },
 closeForwardPicker() {
  chatMessagesStore.setState({forwardPicker: undefined});
 },
 /** Выбранное назначение сразу становится черновиком пересылки в новой переписке. */
 chooseForward(key: string, message: ChatMessage) {
  chatMessagesStore.setState(current => ({
   forwardPicker: undefined,
   forwardDrafts: {...current.forwardDrafts, [key]: {message, comment: ''}}
  }));
 },
 setForwardComment(key: string, message: ChatMessage, comment: string) {
  chatMessagesStore.setState(current => ({forwardDrafts: {...current.forwardDrafts, [key]: {message, comment}}}));
 },
 /** Отправка очищает только тот черновик, который отправляли. */
 clearForwardDraft(key: string, draft: ForwardDraft) {
  chatMessagesStore.setState(current =>
   current.forwardDrafts[key] !== draft ? current : {forwardDrafts: {...current.forwardDrafts, [key]: undefined}}
  );
 },
 cancelForwardDraft(key: string) {
  chatMessagesStore.setState(current => ({forwardDrafts: {...current.forwardDrafts, [key]: undefined}}));
 },
 setAttachment(channel: string, draft: AttachmentDraft | undefined) {
  chatMessagesStore.setState(current => ({attachments: {...current.attachments, [channel]: draft}}));
 },
 setReading(channel: string, reading: boolean) {
  chatMessagesStore.setState(current => ({readingAttachments: {...current.readingAttachments, [channel]: reading}}));
 },
 /** Отправка убирает только то вложение, которое отправили. */
 clearSentAttachment(channel: string, draft: AttachmentDraft) {
  chatMessagesStore.setState(current =>
   current.attachments[channel] !== draft ? current : {attachments: {...current.attachments, [channel]: undefined}}
  );
 },
 resetAttachments() {
  chatMessagesStore.setState({attachments: {}, readingAttachments: {}});
 },
 /** Оптимистичная отправка: запись появляется в переписке сразу, ещё до ответа сервера. */
 beginOutgoing(id: string, draft: OutgoingDraft) {
  chatMessagesStore.setState(current => ({outbox: {...current.outbox, [id]: {status: 'sending', draft}}}));
 },
 /** Повтор берёт тот же черновик: причина ошибки сбрасывается, статус снова «отправляется». */
 retryOutgoing(id: string) {
  chatMessagesStore.setState(current => {
   const entry = current.outbox[id];
   if (!entry) return current;
   return {outbox: {...current.outbox, [id]: {status: 'sending', draft: entry.draft}}};
  });
 },
 failOutgoing(id: string, error: string) {
  chatMessagesStore.setState(current => {
   const entry = current.outbox[id];
   if (!entry) return current;
   return {outbox: {...current.outbox, [id]: {status: 'failed', draft: entry.draft, error}}};
  });
 },
 /** Сервер подтвердил отправку: временное сообщение больше не нужно. */
 discardOutgoing(id: string) {
  chatMessagesStore.setState(current => {
   if (!current.outbox[id]) return current;
   const next = {...current.outbox};
   delete next[id];
   return {outbox: next};
  });
 },
 /**
  * Опрос мог принести настоящее сообщение раньше ответа на отправку:
  * временное совпадение по содержанию и близкому времени убираем, чтобы не было двух одинаковых.
  */
 reconcileOutgoing(messages: readonly ChatMessage[]) {
  chatMessagesStore.setState(current => {
   const kept = Object.entries(current.outbox).filter(
    ([, entry]) => !messages.some(message => matchesServerMessage(entry.draft, message))
   );
   if (kept.length === Object.keys(current.outbox).length) return current;
   return {outbox: Object.fromEntries(kept)};
  });
 }
};

/** Временное сообщение для переписки: обычный ChatMessage с id из пространства `local:`. */
export function outgoingMessage(id: string, draft: OutgoingDraft): ChatMessage {
 return {
  id,
  channel: draft.channel,
  user: draft.user,
  text: outgoingText(draft.text, draft.attachment?.name),
  time: draft.time
 };
}

/** Исходящие одного канала в порядке отправки: в переписке они всегда идут последними. */
export function outgoingEntries(outbox: Record<string, OutgoingEntry>, channel: string) {
 return Object.entries(outbox)
  .filter(([, entry]) => entry.draft.channel === channel)
  .map(([id, entry]) => ({id, message: outgoingMessage(id, entry.draft), status: entry.status, error: entry.error}));
}

/** Тело запроса для отправки и повтора: один и тот же черновик, без черновика поля ввода. */
export function outgoingPayload(draft: OutgoingDraft) {
 return {
  channel: draft.channel,
  text: draft.text,
  mentions: draft.mentions,
  ...(draft.attachment ? {attachment: draft.attachment} : {}),
  ...(draft.replyTo ? {replyTo: draft.replyTo} : {})
 };
}
