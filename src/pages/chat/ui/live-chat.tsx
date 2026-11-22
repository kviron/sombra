import {useEffect, useLayoutEffect, useRef} from 'react';
import {AttachmentDropZone} from '@/features/message-composer';
import {useDirectMessageNotifications, useNotificationActivation} from '@/features/notifications';
import {useRoomMusic, useVoice, VoicePlayback} from '@/features/voice-room';
import type {ForwardDestination} from '@/features/message-actions';
import type {MaterialCategory} from '@/entities/message';
import {useMessageReadState} from '@/entities/message';
import {UserActionsProvider} from '@/shared/lib/user-actions';
import {useScreenGlitch} from '@/shared/ui/use-screen-glitch';
import {chatScrollKey, useChatScroll} from '../lib/use-chat-scroll';
import {useModalFocusTrap} from '../lib/use-modal-focus-trap';
import {useChatState} from '../model/use-chat-state';
import {useChatNavigation} from '../model/use-chat-navigation';
import {useChatPanels} from '../model/use-chat-panels';
import {useChatCalls} from '../model/use-chat-calls';
import {useChatMessages} from '../model/use-chat-messages';
import {useChatContacts} from '../model/use-chat-contacts';
import {musicRoomOf} from '../model/chat-rules';
import {chatMessagesActions} from '../model/chat-messages';
import {ChatSidebar} from './chat-sidebar';
import {ChatHeader} from './chat-header';
import {ChatWorkspace} from './chat-workspace';
import {ChatOverlays} from './chat-overlays';
import {ChatSettingsModal} from './chat-settings-modal';
import {ChatGroupModal} from './chat-group-modal';
import './chat.css';

/**
 * Рабочее пространство чата: страница только собирает срезы и раскладывает их по колонкам.
 * Снапшот, навигация, окна, сообщения, звонки и дружба живут в `model/`.
 */
export function LiveChat() {
 const call = useVoice();
 const chat = useChatState();
 const nav = useChatNavigation({state: chat.state, voice: call});
 const panels = useChatPanels({
  state: chat.state,
  home: nav.home,
  channel: nav.channel,
  peer: nav.peer,
  group: nav.group,
  voice: call
 });
 const calls = useChatCalls({
  state: chat.state,
  voice: call,
  home: nav.home,
  channelId: nav.channelId,
  onOpenDialog: id => {
   nav.actions.openDialog(id);
   panels.actions.closeModal();
  }
 });
 const roomMusic = useRoomMusic(musicRoomOf(chat.state, call.room), call.deaf, call.preferences.speaker);
 /** Прокрутка создаётся ниже: модель отправки получает её через ref, чтобы порядок хуков остался прежним. */
 const follow = useRef<() => void>(() => {});
 const messages = useChatMessages({
  state: chat.state,
  channel: nav.channel,
  home: nav.home,
  group: nav.group,
  peer: nav.peer,
  friends: nav.friends,
  voiceRoom: calls.voiceRoom,
  voice: call,
  panels,
  incomingCall: !!calls.incoming,
  music: roomMusic,
  followOnNextUpdate: () => follow.current()
 });
 const contacts = useChatContacts(chat.state);

 const infoTrigger = useRef<HTMLButtonElement>(null);
 const materialsTrigger = useRef<HTMLButtonElement>(null);
 const composerRef = useRef<HTMLDivElement>(null);
 const scrollRef = useRef<HTMLDivElement>(null);
 const forwardCommentRef = useRef<HTMLTextAreaElement>(null);
 const conversationMotion = useScreenGlitch(`${nav.home}:${nav.groupId}:${nav.channelId}`);
 const settingsMotion = useScreenGlitch(`${panels.settings}:${panels.accountSection}`);

 const scrollKey =
  !nav.friends && !messages.search ? chatScrollKey(chat.state?.me.id || '', nav.channel?.id || '') : '';
 const scroll = useChatScroll(
  scrollRef,
  scrollKey,
  messages.revision,
  messages.jumpTarget,
  messages.jumpEpoch,
  messages.messageIds
 );
 follow.current = scroll.followOnNextUpdate;

 const activateNotification = useNotificationActivation(chat.state, (next, route) => {
  chat.actions.applyState(next);
  panels.actions.closeOverlays();
  messages.actions.setSearch('');
  chat.actions.clearError();
  messages.actions.setPendingJump({channel: route.channel, message: route.message || ''});
  nav.actions.openRoute({home: route.home, group: route.group, channel: route.channel});
  messages.actions.setJump(route.message || '');
 });

 useDirectMessageNotifications(chat.state, {
  activeChannel: nav.channel?.id,
  settingsOpen: panels.settings || !!panels.modal || !!panels.profileId || panels.infoOpen,
  onActivate: activateNotification
 });

 useMessageReadState(chat.state, nav.channel?.id || '', messages.readsBlocked, scroll.acceptRead);

 // Переход к сообщению: подсветка и мягкая прокрутка к строке, затем цель сбрасывается.
 useEffect(() => {
  if (!messages.jumpTarget) return;
  const target = messages.jumpTarget;
  const frame = requestAnimationFrame(() => {
   const element = document.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(target)}"]`);
   element
    ?.getAnimations({subtree: true})
    .filter(animation => animation instanceof CSSAnimation && animation.animationName.includes('message-jump'))
    .forEach(animation => {
     animation.currentTime = 0;
     animation.play();
    });
   element?.scrollIntoView({
    block: 'center',
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'
   });
  });
  const timer = setTimeout(() => chatMessagesActions.clearJump(), 2500);
  return () => {
   cancelAnimationFrame(frame);
   clearTimeout(timer);
  };
 }, [messages.jumpTarget, messages.jumpEpoch, messages.search]);

 // The composer floats over the transcript, so its measured height becomes the
 // scroll container's bottom padding. A CSS variable keeps LiveChat from re-rendering
 // every time the field grows; the observer is the only source of that number.
 useLayoutEffect(() => {
  const composer = composerRef.current,
   scroller = scrollRef.current;
  if (!composer || !scroller) return;
  let frame = 0;
  // The measured panel height is a pure function of the composer, and the scroll jump
  // is deferred a frame: resizing the pad inside the observer callback is what makes
  // browsers report "ResizeObserver loop completed with undelivered notifications".
  const sync = () => {
   scroller.parentElement?.style.setProperty('--sombra-composer-height', `${composer.offsetHeight}px`);
   if (!scroll.sticky.current || !scrollKey) return;
   cancelAnimationFrame(frame);
   frame = requestAnimationFrame(() => {
    if (scroll.sticky.current) scroller.scrollTop = scroller.scrollHeight;
   });
  };
  window.addEventListener('resize', sync);
  sync();
  // Apply the first bottom restoration against the actual composer padding, before
  // its scroll event could turn the temporary padding gap into a history anchor.
  if (scrollKey && scroll.sticky.current) scroller.scrollTop = scroller.scrollHeight;
  const observer = new ResizeObserver(sync);
  observer.observe(composer);
  return () => {
   cancelAnimationFrame(frame);
   observer.disconnect();
   window.removeEventListener('resize', sync);
  };
 }, [nav.channel?.id, messages.voiceLayout, nav.friends, scrollKey]);

 useModalFocusTrap({
  active: (!!panels.modal && panels.modal !== 'dialog' && panels.modal !== 'edit-group') || panels.settings,
  busy: chat.busy,
  onEscape: panels.actions.dismiss
 });

 /** Материалы открываются из сведений о чате: фокус уходит в их первую кнопку. */
 function openInfoMaterials(category: MaterialCategory) {
  panels.actions.openMaterials(category);
  requestAnimationFrame(() => document.querySelector<HTMLElement>('#conversation-materials button')?.focus());
 }

 /** Возврат из сведений к профилю участника: фокус остаётся в шапке чата. */
 function openInfoProfile(id: string) {
  panels.actions.closeInfo();
  requestAnimationFrame(() => {
   infoTrigger.current?.focus();
   panels.actions.openProfile(id);
  });
 }

 function closeMaterials() {
  panels.actions.closeMaterials();
  requestAnimationFrame(() => materialsTrigger.current?.focus());
 }

 function jumpToMessage(id: string, fromMaterials = true) {
  messages.actions.jumpTo(id, chat.state?.me.id || '');
  messages.actions.clearSearch();
  if (fromMaterials) {
   panels.actions.closeMaterials();
   requestAnimationFrame(() => materialsTrigger.current?.focus({preventScroll: true}));
  }
 }

 /** Пересылка: черновик уже в выбранной переписке, курсор — в комментарии. */
 function chooseForward(item: ForwardDestination) {
  messages.actions.chooseForward(item);
  nav.actions.openDestination(item);
  requestAnimationFrame(() => forwardCommentRef.current?.focus());
 }

 return (
  <UserActionsProvider
   value={{
    me: chat.state?.me,
    openProfile: id => panels.actions.openProfile(id),
    messageUser: id => void nav.actions.messageUser(id),
    editOwnProfile: panels.actions.openOwnProfile,
    friendStatus: contacts.status,
    addFriend: id => void contacts.request(id),
    acceptFriend: id => void contacts.accept(id),
    removeFriend: id => void contacts.remove(id)
   }}
  >
   <main className="chat-shell">
    {/* Playback belongs to the joined session, never Home/DM/channel navigation. */}
    <VoicePlayback voice={call} volumeForUser={calls.volumeForUser} />
    {roomMusic.audio}
    <ChatSidebar state={chat.state} nav={nav} panels={panels} calls={calls} call={call} />
    <AttachmentDropZone
     channel={nav.channel?.id}
     disabled={
      !!messages.forwardDraft ||
      !!messages.picker ||
      chat.busy ||
      messages.readingAttachment ||
      panels.settings ||
      !!panels.modal ||
      !!panels.profileId ||
      panels.infoOpen ||
      !!calls.incoming
     }
     onFile={file => void messages.actions.selectAttachment(file)}
    >
     <ChatHeader
      chat={chat}
      nav={nav}
      panels={panels}
      messages={messages}
      calls={calls}
      call={call}
      infoTrigger={infoTrigger}
      materialsTrigger={materialsTrigger}
     />
     <ChatWorkspace
      chat={chat}
      state={chat.state}
      nav={nav}
      panels={panels}
      messages={messages}
      call={call}
      music={!nav.home ? roomMusic : undefined}
      scroll={scroll}
      scrollRef={scrollRef}
      scrollKey={scrollKey}
      voiceRoom={calls.voiceRoom}
      composerRef={composerRef}
      forwardCommentRef={forwardCommentRef}
      motionRef={conversationMotion}
      onCloseMaterials={closeMaterials}
      onJump={jumpToMessage}
     />
    </AttachmentDropZone>
    <ChatSettingsModal chat={chat} state={chat.state} panels={panels} call={call} panelRef={settingsMotion} />
    <ChatOverlays
     chat={chat}
     state={chat.state}
     nav={nav}
     panels={panels}
     messages={messages}
     calls={calls}
     call={call}
     infoTrigger={infoTrigger}
     onChooseForward={chooseForward}
     onOpenMaterials={openInfoMaterials}
     onOpenProfileFromInfo={openInfoProfile}
    >
     <ChatGroupModal chat={chat} state={chat.state} nav={nav} panels={panels} />
    </ChatOverlays>
   </main>
  </UserActionsProvider>
 );
}
