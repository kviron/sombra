import {useEffect, useLayoutEffect, useMemo, useRef} from 'react';
import {useStore} from 'zustand';
import {toast} from 'sonner';
import {
 attachmentSelectionError,
 readAttachment,
 mentionCandidates,
 useChatDraft,
 useMessageLink
} from '@/features/message-composer';
import {hasLiveImageActivity} from '@/features/bots';
import {editMentionDraft, mentionSendPayload, messageService} from '@/entities/message';
import type {MentionDraft, VerifiedMention} from '@/entities/message';
import {useHumanTyping} from '@/entities/user';
import type {ForwardDestination} from '@/features/message-actions';
import type {Voice} from '@/features/voice-room';
import {sessionService} from '@/shared/api';
import {stageAttachments} from './outgoing-attachments';
import {parseMusicCommand} from '@/shared/lib/music-command';
import type {ChatMessage, ChatState, Channel, Dialog, Group, User} from '@/shared/types';
import {chatMessagesActions, chatMessagesStore, outgoingEntries, outgoingPayload} from './chat-messages';
import type {OutgoingDraft, OutgoingEntry} from './chat-messages';
import {chatSnapshotActions, chatSnapshotStore} from './chat-state';
import {historyTruncated, mergeHistoryMessages} from './chat-history-rules';
import {chatHistoryActions} from './chat-history';
import {useChatHistory} from './use-chat-history';
import {
 filterMessages,
 humanTypingEnabled,
 isVoiceView,
 localMessageId,
 musicRoomOf,
 readsBlocked,
 referenceDraftKey,
 referencesSupported,
 sendDisabled
} from './chat-rules';
import type {ChatPanelsModel} from './use-chat-panels';

type MusicCommand = NonNullable<ReturnType<typeof parseMusicCommand>>;
type Music = {
 command: (action: MusicCommand['action'], url: MusicCommand['url'], limit: MusicCommand['limit']) => Promise<unknown>;
};

type Options = {
 state: ChatState | null;
 channel: Dialog | Channel | undefined;
 home: boolean;
 group: Group | undefined;
 peer: User | undefined;
 friends: boolean;
 voiceRoom: string | undefined;
 voice: Voice;
 panels: ChatPanelsModel;
 incomingCall: boolean;
 music: Music;
};

/**
 * Всё, что происходит с сообщениями: черновик текста и вложения, упоминания, ответ, пересылка.
 * Правка, удаление и реакции остаются в `entities/message` и каноническом `MessageItem`.
 */
export function useChatMessages({
 state,
 channel,
 home,
 group,
 peer,
 friends,
 voiceRoom,
 voice,
 panels,
 incomingCall,
 music
}: Options) {
 const messages = useStore(chatMessagesStore);
 const destination = channel?.id || '';
 /** Страницы старых сообщений: подмешиваются перед снапшотом, порядок и дни не меняются. */
 const history = useChatHistory({state, channel: destination});
 const meId = state?.me.id || '';
 const quoteRequest = useRef(0);
 useLayoutEffect(
  () => () => {
   quoteRequest.current++;
  },
  [meId, destination]
 );
 const busy = chatSnapshotStore.getState().busy;
 const referenceKey = referenceDraftKey(meId, channel?.id);
 const {draft, getDraft, setDraft: storeDraft, clearSent} = useChatDraft(referenceKey);
 const mentionDrafts = useRef<Record<string, MentionDraft>>({});
 const previousMessageIds = useRef(new Set<string>());
 const attachments = messages.attachments[referenceKey] || [];
 const references = referencesSupported(state);
 const replyDraft = references ? messages.replyDrafts[referenceKey] : undefined;
 const forwardDraft = references ? messages.forwardDrafts[referenceKey] : undefined;
 const picker = references && messages.forwardPicker?.owner === meId ? messages.forwardPicker : undefined;
 const jumpTarget = messages.jumpOwner === meId ? messages.jumpMessage : '';
 const voiceLayout = isVoiceView({channel, voiceRoom, room: voice.room});
 const musicRoom = musicRoomOf(state, voice.room);
 const imageActivity = !!state && !!channel && hasLiveImageActivity(state, channel.id);
 const {messages: serverMessages, users} = state ?? {};
 const {outbox, search} = messages;
 const chatMessages = useMemo(
  () =>
   mergeHistoryMessages(
    history.messages,
    serverMessages?.filter(message => message.channel === destination) ?? [],
    outgoingEntries(outbox, destination, meId).map(item => item.message)
   ),
  [history.messages, serverMessages, outbox, destination, meId]
 );
 const visibleMessages = useMemo(
  () => filterMessages({messages: chatMessages, search, users: users ?? []}),
  [chatMessages, search, users]
 );

 const humanTyping = useHumanTyping(
  state,
  destination,
  humanTypingEnabled({
   state,
   peer,
   busy,
   settings: panels.settings,
   modal: !!panels.modal,
   profile: !!panels.profileId,
   info: panels.infoOpen,
   botSettings: !!panels.botSettingsId,
   roles: !!panels.rolesGroupId
  })
 );

 /** Ввод текста обновляет и черновик, и карту упоминаний: смещения живут вместе с текстом. */
 function setDraft(text: string) {
  mentionDrafts.current[referenceKey] = editMentionDraft(
   mentionDrafts.current[referenceKey] || {text: draft, mentions: []},
   text
  );
  storeDraft(text);
  humanTyping.input(!!text.trim());
 }

 const messageLink = useMessageLink({
  channel: destination,
  draft,
  setDraft,
  disabled: busy || panels.settings || !!panels.modal || !!panels.profileId || panels.infoOpen || incomingCall
 });

 useEffect(() => () => chatMessagesActions.reset(), []);

 useLayoutEffect(() => {
  mentionDrafts.current = {};
  previousMessageIds.current = new Set();
  return () => chatMessagesActions.resetOutgoingDrafts();
 }, [meId]);

 // Смена переписки закрывает поиск и один раз применяет отложенный переход из уведомления.
 useEffect(() => {
  chatMessagesActions.onChannelChange(destination);
 }, [destination]);

 // Когда опрос опередил ответ на отправку, убираем временное сообщение до отрисовки.
 useLayoutEffect(() => {
  const incoming = state?.messages || [];
  chatMessagesActions.reconcileOutgoing(incoming, previousMessageIds.current);
  previousMessageIds.current = new Set(incoming.map(message => message.id));
 }, [state?.messages]);

 /** Псевдонимы участников ограничены перепиской: устаревший псевдоним не должен уйти на сервер. */
 function mentionAliases(target: string) {
  const snapshot = chatSnapshotStore.getState().snapshot;
  if (!snapshot) return [];
  return mentionCandidates(snapshot, target, home ? undefined : group?.id).map(item => {
   const user = snapshot.users.find(row => row.id === item.id);
   const bot = snapshot.bots.find(row => row.id === item.id);
   return {id: item.id, name: user?.name || bot?.name || item.label, username: user?.username || bot?.username};
  });
 }

 function selectAttachments(files: File[]) {
  const snapshot = chatSnapshotStore.getState();
  if (!destination || !files.length || snapshot.busy || snapshot.snapshot?.me.id !== meId) return;
  const current = chatMessagesStore.getState().attachments[referenceKey] || [];
  const error = attachmentSelectionError(current.length, files);
  if (error) {
   toast.error(error);
   return;
  }
  chatMessagesActions.setAttachments(referenceKey, [
   ...current,
   ...files.map(file => ({id: crypto.randomUUID(), file}))
  ]);
 }

 function removeAttachment(id: string) {
  chatMessagesActions.removeAttachment(referenceKey, id);
 }

 /** Поле ввода сразу готово к следующему сообщению; все данные повтора принадлежат записи outbox. */
 async function deliverOutgoing(id: string, entry: OutgoingEntry) {
  const {draft: outgoing, uploadedIds} = entry;
  const {channel, user, files} = outgoing;
  const session = sessionService.token();
  function requireCurrent() {
   if (
    sessionService.token() !== session ||
    chatSnapshotStore.getState().snapshot?.me.id !== user ||
    chatMessagesStore.getState().outbox[id]?.draft !== outgoing
   )
    throw new Error('Сессия изменилась.');
  }
  try {
   const payload = outgoingPayload(outgoing);
   let media: {attachment_ids?: string[]; attachment?: Awaited<ReturnType<typeof readAttachment>>} = {};
   if (files.length === 1) {
    media = {attachment: await readAttachment(files[0])};
   } else if (files.length > 1) {
    if (!chatSnapshotStore.getState().snapshot?.features?.messageAttachments)
     throw new Error('Для отправки нескольких вложений обновите сервер Sombra.');
    const ids = await stageAttachments(
     files,
     uploadedIds,
     async file => {
      requireCurrent();
      const attachment = await readAttachment(file);
      requireCurrent();
      return (await messageService.uploadAttachment<{id: string}>({channel, attachment})).id;
     },
     ids => chatMessagesActions.updateOutgoing(id, {uploadedIds: ids})
    );
    media = {attachment_ids: ids};
   }
   requireCurrent();
   const result = await messageService.send<{id: string}>({...payload, ...media});
   if (!result?.id) throw new Error('Сервер не подтвердил отправку сообщения.');
   chatMessagesActions.updateOutgoing(id, {publishedId: result.id});
   if (chatSnapshotStore.getState().snapshot?.messages.some(message => message.id === result.id))
    chatMessagesActions.discardOutgoing(id);
  } catch (error) {
   let reason = (error as Error).message;
   if (reason.includes('MESSAGE_ATTACHMENTS_UNAVAILABLE')) {
    chatMessagesActions.updateOutgoing(id, {uploadedIds: []});
    reason = 'Загруженные файлы больше недоступны. Повторите отправку, чтобы загрузить их снова.';
   } else if (reason.includes('MESSAGE_ATTACHMENTS_LIMIT')) {
    reason = 'На сервере слишком много файлов в очереди. Попробуйте позже.';
   } else if (reason.includes('MESSAGE_ATTACHMENTS_CONFLICT')) {
    reason = 'Эти файлы уже опубликованы в другом сообщении.';
   } else if (reason.includes('MESSAGE_ATTACHMENTS_INVALID')) {
    reason = 'Сервер отклонил список вложений.';
   }
   chatMessagesActions.failOutgoing(id, reason);
   return;
  }
  if (sessionService.token() === session && chatSnapshotStore.getState().snapshot?.me.id === user)
   await chatSnapshotActions.refresh().catch(reason => {
    if (chatSnapshotStore.getState().snapshot?.me.id === user) chatSnapshotActions.setError((reason as Error).message);
   });
 }

 /** Отправка: музыкальная команда уходит в комнату, остальное — сообщением с упоминаниями. */
 async function send() {
  const sent = getDraft();
  const files = (chatMessagesStore.getState().attachments[referenceKey] || []).map(item => item.file);
  const snapshot = chatSnapshotStore.getState();
  if (!destination || (!sent.trim() && !files.length) || snapshot.busy || snapshot.snapshot?.me.id !== meId) return;
  if (files.length > 1 && !snapshot.snapshot.features?.messageAttachments) {
   toast.error('Для отправки нескольких вложений обновите сервер Sombra.');
   return;
  }
  humanTyping.stop();
  chatSnapshotActions.clearError();
  if (!home && voiceLayout && !files.length && !replyDraft) {
   const musicCommand = parseMusicCommand(sent);
   if (musicCommand) {
    chatSnapshotActions.setBusy(true);
    try {
     if (musicRoom !== destination) throw new Error('Сначала войдите в эту голосовую комнату.');
     await music.command(musicCommand.action, musicCommand.url, musicCommand.limit);
     if (mentionDrafts.current[referenceKey]?.text === sent) delete mentionDrafts.current[referenceKey];
     clearSent(referenceKey, sent);
    } catch (error) {
     chatSnapshotActions.setError((error as Error).message);
    } finally {
     chatSnapshotActions.setBusy(false);
    }
    return;
   }
  }
  // Сервер обрезает текст сам; отправляем ту же обрезанную строку, чтобы смещения упоминаний сошлись.
  const payload = mentionSendPayload(
   mentionDrafts.current[referenceKey] || {text: sent, mentions: []},
   sent,
   mentionAliases(destination)
  );
  const draftMessage: OutgoingDraft = {
   channel: destination,
   user: meId,
   text: payload.text,
   mentions: payload.mentions,
   files,
   ...(replyDraft ? {replyTo: replyDraft.id} : {}),
   time: Date.now() / 1000
  };
  // Поле очищается сразу, сообщение уже в переписке со статусом «отправляется».
  const id = localMessageId(crypto.randomUUID());
  chatMessagesActions.beginOutgoing(id, referenceKey, draftMessage);
  clearSent(referenceKey, sent);
  delete mentionDrafts.current[referenceKey];
  await deliverOutgoing(id, chatMessagesStore.getState().outbox[id]);
 }

 async function retryOutgoing(id: string) {
  const entry = chatMessagesStore.getState().outbox[id];
  if (!entry || entry.status !== 'failed' || chatSnapshotStore.getState().snapshot?.me.id !== entry.draft.user) return;
  chatMessagesActions.retryOutgoing(id);
  await deliverOutgoing(id, entry);
 }

 async function sendForward() {
  if (!destination || !forwardDraft || chatSnapshotStore.getState().busy) return;
  const sent = forwardDraft;
  const comment = sent.comment.trim();
  chatSnapshotActions.setBusy(true);
  chatSnapshotActions.clearError();
  try {
   await messageService.forward<{messages: ChatMessage[]}>({
    message: sent.message.id,
    channel: destination,
    ...(comment ? {comment} : {})
   });
   chatMessagesActions.clearForwardDraft(referenceKey, sent);
   void chatSnapshotActions.refresh().catch(reason => chatSnapshotActions.setError((reason as Error).message));
  } catch (reason) {
   chatSnapshotActions.setError((reason as Error).message);
  } finally {
   chatSnapshotActions.setBusy(false);
  }
 }

 async function sendStickerSuggestion(sticker: string, replaceDraft: boolean) {
  const sent = draft;
  if (!destination || chatSnapshotStore.getState().busy) return false;
  humanTyping.stop();
  chatSnapshotActions.setBusy(true);
  chatSnapshotActions.clearError();
  try {
   await messageService.send({channel: destination, sticker, ...(replyDraft ? {replyTo: replyDraft.id} : {})});
   if (replyDraft) chatMessagesActions.cancelReply(referenceKey, replyDraft);
   if (replaceDraft) clearSent(referenceKey, sent);
   if (replaceDraft && mentionDrafts.current[referenceKey]?.text === sent) delete mentionDrafts.current[referenceKey];
   void chatSnapshotActions.refresh().catch(error => chatSnapshotActions.setError((error as Error).message));
   return true;
  } catch (error) {
   chatSnapshotActions.setError((error as Error).message);
   return false;
  } finally {
   chatSnapshotActions.setBusy(false);
  }
 }

 const actions = {
  send,
  sendForward,
  sendStickerSuggestion,
  setDraft,
  selectAttachments,
  removeAttachment,
  /** Маршрут уведомления: отложенный переход применяется при смене переписки. */
  setPendingJump: chatMessagesActions.setPendingJump,
  setJump: chatMessagesActions.setJump,
  jumpTo: chatMessagesActions.jumpTo,
  /** Повтор и отказ от временного сообщения: статус живёт в outbox, а не в общем «занято». */
  retry: retryOutgoing,
  discard: chatMessagesActions.discardOutgoing,
  setSearch: chatMessagesActions.setSearch,
  clearSearch: chatMessagesActions.clearSearch,
  /** Ответ возвращает курсор в поле ввода: текст остаётся прежним. */
  replyTo(message: ChatMessage) {
   chatMessagesActions.startReply(referenceKey, message);
   requestAnimationFrame(() => messageLink.textareaRef.current?.focus());
  },
  cancelReply() {
   chatMessagesActions.cancelReply(referenceKey);
  },
  openForwardPicker(message: ChatMessage) {
   if (meId) chatMessagesActions.openForwardPicker(meId, message);
  },
  closeForwardPicker() {
   chatMessagesActions.closeForwardPicker();
  },
  /** Выбранное назначение становится черновиком пересылки уже в новой переписке. */
  chooseForward(item: ForwardDestination) {
   if (!meId || !picker) return;
   chatMessagesActions.chooseForward(referenceDraftKey(meId, item.id), picker.message);
  },
  setForwardComment(comment: string) {
   if (forwardDraft) chatMessagesActions.setForwardComment(referenceKey, forwardDraft.message, comment);
  },
  cancelForward() {
   chatMessagesActions.cancelForwardDraft(referenceKey);
  },
  insertMention(mention: VerifiedMention, text: string) {
   const current = editMentionDraft(mentionDrafts.current[referenceKey] || {text: draft, mentions: []}, text);
   mentionDrafts.current[referenceKey] = {
    text,
    mentions: [...current.mentions.filter(item => item.end <= mention.start || item.start >= mention.end), mention]
   };
  },
  async jumpToQuote(id: string) {
   const request = ++quoteRequest.current;
   const epoch = chatMessagesStore.getState().jumpEpoch;
   const current = () =>
    quoteRequest.current === request &&
    chatMessagesStore.getState().jumpEpoch === epoch &&
    chatSnapshotStore.getState().snapshot?.me.id === meId;
   if (!meId || !destination || !current()) return;
   let found = chatMessages.some(message => message.id === id);
   if (!found && (history.hasMore || historyTruncated(state, destination))) {
    try {
     found = await chatHistoryActions.findMessage(destination, id, current);
    } catch {
     if (current()) toast.error('Не удалось загрузить историю. Попробуйте ещё раз.');
     return;
    }
   }
   if (!current()) return;
   if (!found) {
    toast.error('Исходное сообщение недоступно');
    return;
   }
   chatMessagesActions.clearSearch();
   chatMessagesActions.jumpTo(id, meId);
  },
  onChannelChange() {
   chatMessagesActions.onChannelChange(destination);
  }
 };

 return {
  draft,
  textareaRef: messageLink.textareaRef,
  linkDialog: messageLink.dialog,
  replyDraft,
  forwardDraft,
  picker,
  referencesSupported: references,
  attachments,
  search: messages.search,
  jumpTarget,
  jumpEpoch: messages.jumpEpoch,
  visibleMessages,
  /** Исходящие до ответа сервера: по ним транскрипт рисует крутилку или «!». */
  outbox: messages.outbox,
  /** Догрузка истории канала: кнопка, автодогрузка и сохранение прокрутки — в транскрипте. */
  history: {
   hasMore: history.hasMore,
   loading: history.loading,
   error: history.error,
   loadOlder: history.loadOlder
  },
  imageActivityVisible: imageActivity,
  voiceLayout,
  sendDisabled: sendDisabled({
   busy,
   reading: false,
   hasChannel: !!channel,
   draft,
   attachment: attachments.length > 0
  }),
  readsBlocked: readsBlocked({
   settings: panels.settings,
   modal: !!panels.modal,
   profile: !!panels.profile,
   headerProfile: panels.headerProfile,
   info: panels.infoOpen,
   roles: !!panels.rolesGroup,
   managedBot: !!panels.managedBot,
   incoming: incomingCall,
   friends,
   picker: !!picker
  }),
  actions
 };
}

export type ChatMessagesModel = ReturnType<typeof useChatMessages>;
