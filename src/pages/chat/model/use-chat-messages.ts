import {useEffect, useMemo, useRef} from 'react';
import {useStore} from 'zustand';
import {toast} from 'sonner';
import {readAttachment, mentionCandidates, useChatDraft, useMessageLink} from '@/features/message-composer';
import {hasLiveImageActivity} from '@/features/bots';
import {editMentionDraft, mentionSendPayload, messageService} from '@/entities/message';
import type {MentionDraft, VerifiedMention} from '@/entities/message';
import {useHumanTyping} from '@/entities/user';
import type {ForwardDestination} from '@/features/message-actions';
import type {Voice} from '@/features/voice-room';
import {parseMusicCommand} from '@/shared/lib/music-command';
import type {ChatMessage, ChatState, Channel, Dialog, Group, User} from '@/shared/types';
import {chatMessagesActions, chatMessagesStore, outgoingEntries, outgoingPayload} from './chat-messages';
import type {OutgoingDraft} from './chat-messages';
import {chatSnapshotActions, chatSnapshotStore} from './chat-state';
import {mergeHistoryMessages} from './chat-history-rules';
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
 const busy = chatSnapshotStore.getState().busy;
 const {draft, setDraft: storeDraft, clearSent} = useChatDraft(destination);
 const mentionDrafts = useRef<Record<string, MentionDraft>>({});
 const attachmentReads = useRef<Record<string, number>>({});
 const attachmentOwner = useRef(meId);
 attachmentOwner.current = meId;
 const attachmentMounted = useRef(true);

 const attachment = channel ? messages.attachments[channel.id] : undefined;
 const readingAttachment = channel ? !!messages.readingAttachments[channel.id] : false;
 const referenceKey = referenceDraftKey(meId, channel?.id);
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
    outgoingEntries(outbox, destination).map(item => item.message)
   ),
  [history.messages, serverMessages, outbox, destination]
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
  mentionDrafts.current[destination] = editMentionDraft(
   mentionDrafts.current[destination] || {text: draft, mentions: []},
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

 useEffect(() => {
  mentionDrafts.current = {};
 }, [meId]);

 // Смена переписки закрывает поиск и один раз применяет отложенный переход из уведомления.
 useEffect(() => {
  chatMessagesActions.onChannelChange(destination);
 }, [destination]);

 // Опрос мог принести настоящее сообщение раньше ответа на отправку — временное убираем.
 useEffect(() => {
  chatMessagesActions.reconcileOutgoing(state?.messages || []);
 }, [state?.messages]);

 useEffect(() => {
  attachmentMounted.current = true;
  return () => {
   attachmentMounted.current = false;
   attachmentReads.current = {};
  };
 }, []);

 useEffect(() => {
  attachmentReads.current = {};
  chatMessagesActions.resetAttachments();
 }, [meId]);

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

 async function selectAttachment(file: File) {
  const snapshot = chatSnapshotStore.getState();
  if (!destination || snapshot.busy) return;
  const owner = snapshot.snapshot?.me.id || '';
  const epoch = (attachmentReads.current[destination] || 0) + 1;
  const current = () =>
   attachmentMounted.current && attachmentOwner.current === owner && attachmentReads.current[destination] === epoch;
  attachmentReads.current[destination] = epoch;
  chatMessagesActions.setReading(destination, true);
  try {
   const result = await readAttachment(file);
   if (current()) chatMessagesActions.setAttachment(destination, result);
  } catch (error) {
   if (current()) toast.error((error as Error).message);
  } finally {
   if (current()) chatMessagesActions.setReading(destination, false);
  }
 }

 function removeAttachment() {
  if (!destination) return;
  attachmentReads.current[destination] = (attachmentReads.current[destination] || 0) + 1;
  chatMessagesActions.setAttachment(destination, undefined);
  chatMessagesActions.setReading(destination, false);
 }

 /** Отправка: музыкальная команда уходит в комнату, остальное — сообщением с упоминаниями. */
 async function send() {
  const sent = draft;
  const sentAttachment = attachment;
  if (!destination || (!sent.trim() && !sentAttachment) || chatSnapshotStore.getState().busy || readingAttachment)
   return;
  humanTyping.stop();
  chatSnapshotActions.clearError();
  if (!home && voiceLayout && !sentAttachment && !replyDraft) {
   const musicCommand = parseMusicCommand(sent);
   if (musicCommand) {
    chatSnapshotActions.setBusy(true);
    try {
     if (musicRoom !== destination) throw new Error('Сначала войдите в эту голосовую комнату.');
     await music.command(musicCommand.action, musicCommand.url, musicCommand.limit);
     if (mentionDrafts.current[destination]?.text === sent) delete mentionDrafts.current[destination];
     clearSent(destination, sent);
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
   mentionDrafts.current[destination] || {text: sent, mentions: []},
   sent,
   mentionAliases(destination)
  );
  const draftMessage: OutgoingDraft = {
   channel: destination,
   user: meId,
   text: payload.text,
   mentions: payload.mentions,
   ...(sentAttachment ? {attachment: sentAttachment} : {}),
   ...(replyDraft ? {replyTo: replyDraft.id} : {}),
   time: Date.now() / 1000
  };
  // Поле очищается сразу, сообщение уже в переписке со статусом «отправляется».
  const id = localMessageId(crypto.randomUUID());
  chatMessagesActions.beginOutgoing(id, draftMessage);
  clearSent(destination, sent);
  try {
   const message = await messageService.send<ChatMessage>(outgoingPayload(draftMessage));
   chatMessagesActions.discardOutgoing(id);
   if (message?.id) chatSnapshotActions.appendMessage(message);
   if (replyDraft) chatMessagesActions.cancelReply(referenceKey, replyDraft);
   if (mentionDrafts.current[destination]?.text === sent) delete mentionDrafts.current[destination];
   if (sentAttachment) chatMessagesActions.clearSentAttachment(destination, sentAttachment);
   // Опрос мог ещё не увидеть новое сообщение: держим его в переписке до следующего снапшота.
   await chatSnapshotActions.refresh().catch(reason => chatSnapshotActions.setError((reason as Error).message));
   if (!chatSnapshotStore.getState().snapshot?.messages.some(item => item.id === message.id))
    chatSnapshotActions.appendMessage(message);
  } catch (error) {
   chatMessagesActions.failOutgoing(id, (error as Error).message);
  }
 }

 /** Повтор неудачной отправки: тот же черновик, статус снова «отправляется». */
 async function retryOutgoing(id: string) {
  const entry = chatMessagesStore.getState().outbox[id];
  if (!entry || entry.status === 'sending') return;
  chatMessagesActions.retryOutgoing(id);
  try {
   const message = await messageService.send<ChatMessage>(outgoingPayload(entry.draft));
   chatMessagesActions.discardOutgoing(id);
   if (message?.id) chatSnapshotActions.appendMessage(message);
   if (entry.draft.attachment) chatMessagesActions.clearSentAttachment(entry.draft.channel, entry.draft.attachment);
   await chatSnapshotActions.refresh().catch(reason => chatSnapshotActions.setError((reason as Error).message));
   if (!chatSnapshotStore.getState().snapshot?.messages.some(item => item.id === message.id))
    chatSnapshotActions.appendMessage(message);
  } catch (error) {
   chatMessagesActions.failOutgoing(id, (error as Error).message);
  }
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
   if (replaceDraft) clearSent(destination, sent);
   if (replaceDraft && mentionDrafts.current[destination]?.text === sent) delete mentionDrafts.current[destination];
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
  selectAttachment,
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
   const current = editMentionDraft(mentionDrafts.current[destination] || {text: draft, mentions: []}, text);
   mentionDrafts.current[destination] = {
    text,
    mentions: [...current.mentions.filter(item => item.end <= mention.start || item.start >= mention.end), mention]
   };
  },
  jumpToQuote(id: string) {
   const snapshot = chatSnapshotStore.getState().snapshot;
   if (!snapshot?.messages.some(message => message.id === id && message.channel === destination)) {
    toast.error('Исходное сообщение недоступно');
    return;
   }
   chatMessagesActions.jumpTo(id, snapshot.me.id);
   chatMessagesActions.clearSearch();
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
  attachment,
  readingAttachment,
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
   reading: readingAttachment,
   hasChannel: !!channel,
   draft,
   attachment: !!attachment
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
