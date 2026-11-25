import {ResizableHandle, ResizablePanel, ResizablePanelGroup} from '@/shared/ui/resizable';
import {useEffect, useLayoutEffect, useRef, useState, type ReactNode} from 'react';
import {AttachmentDropZone} from '@/features/message-composer';
import {useDirectMessageNotifications, useNotificationActivation} from '@/features/notifications';
import {useRoomMusic, useVoice, VoicePlayback, VoiceStageGradient} from '@/features/voice-room';
import type {ForwardDestination} from '@/features/message-actions';
import type {MaterialCategory} from '@/entities/message';
import {useMessageReadState} from '@/entities/message';
import {useRenderStorm} from '@/shared/lib';
import {UserActionsProvider} from '@/shared/lib/user-actions';
import {useScreenGlitch} from '@/shared/ui/use-screen-glitch';
import {useModalFocusTrap} from '../lib/use-modal-focus-trap';
import {useChatState} from '../model/use-chat-state';
import {useChatNavigation} from '../model/use-chat-navigation';
import {useChatPanels} from '../model/use-chat-panels';
import {useChatCalls} from '../model/use-chat-calls';
import {useChatMessages} from '../model/use-chat-messages';
import {useChatContacts} from '../model/use-chat-contacts';
import {musicRoomOf} from '../model/chat-rules';
import {ChatSidebar, ChatServerRail, ChatProfileControls} from './chat-sidebar';
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
export function LiveChat({appearanceSettings}: {appearanceSettings: ReactNode}) {
 useRenderStorm('LiveChat');
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
 const roomMusic = useRoomMusic(musicRoomOf(chat.state, call.room), call.deaf, call.speakerOutput);
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
  music: roomMusic
 });
 const contacts = useChatContacts(chat.state);
 const stageRoom = messages.voiceLayout ? calls.voiceRoom || nav.channel?.id : undefined;
 const [expandedRoom, setExpandedRoom] = useState<string>();
 const [expandedChatOpen, setExpandedChatOpen] = useState(false);
 const [hiddenVoiceChatRoom, setHiddenVoiceChatRoom] = useState<string>();
 const expandedVoice = !!stageRoom && expandedRoom === stageRoom && call.room === stageRoom;
 const voiceChatOpen = expandedVoice ? expandedChatOpen : !stageRoom || hiddenVoiceChatRoom !== stageRoom;
 function toggleVoiceChat() {
  if (expandedVoice) setExpandedChatOpen(open => !open);
  else setHiddenVoiceChatRoom(voiceChatOpen ? stageRoom : undefined);
 }
 if (expandedRoom && !expandedVoice) {
  setExpandedRoom(undefined);
  setExpandedChatOpen(false);
 }
 const voiceExpandButton = useRef<HTMLButtonElement>(null);
 const voiceOverlayOpen =
  panels.settings || !!panels.modal || !!panels.profileId || panels.infoOpen || !!calls.incoming;

 useEffect(() => {
  if (!expandedVoice || voiceOverlayOpen) return;
  function exitOnEscape(event: KeyboardEvent) {
   if (event.key !== 'Escape' || event.defaultPrevented) return;
   event.preventDefault();
   setExpandedRoom(undefined);
   setExpandedChatOpen(false);
   voiceExpandButton.current?.focus();
  }
  window.addEventListener('keydown', exitOnEscape);
  return () => window.removeEventListener('keydown', exitOnEscape);
 }, [expandedVoice, voiceOverlayOpen]);

 const infoTrigger = useRef<HTMLButtonElement>(null);
 const materialsTrigger = useRef<HTMLButtonElement>(null);
 const composerRef = useRef<HTMLDivElement>(null);
 const forwardCommentRef = useRef<HTMLTextAreaElement>(null);
 const conversationMotion = useScreenGlitch(`${nav.home}:${nav.groupId}:${nav.channelId}`);
 const settingsMotion = useScreenGlitch(`${panels.settings}:${panels.accountSection}`);

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

 useMessageReadState(chat.state, nav.channel?.id || '', messages.readsBlocked || !voiceChatOpen);

 useLayoutEffect(() => {
  const composer = composerRef.current;
  const main = composer?.closest<HTMLElement>('.chat-main');
  if (!composer || !main) return;
  const sync = () => main.style.setProperty('--sombra-composer-height', `${composer.offsetHeight}px`);
  sync();
  const observer = new ResizeObserver(sync);
  observer.observe(composer);
  return () => {
   observer.disconnect();
   main.style.removeProperty('--sombra-composer-height');
  };
 }, [nav.channel?.id, nav.friends, messages.voiceLayout]);

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
   <main
    className="chat-shell text-foreground relative isolate flex min-h-0 flex-1 bg-transparent [font-family:var(--font-sans),Arial,sans-serif] text-[14px] leading-[normal]"
    data-voice-expanded={expandedVoice || undefined}
   >
    {messages.voiceLayout && (calls.voiceRoom || nav.channel?.id) && <VoiceStageGradient />}
    {/* Playback belongs to the joined session, never Home/DM/channel navigation. */}
    <VoicePlayback voice={call} volumeForUser={calls.volumeForUser} />
    <audio ref={roomMusic.engine} src={roomMusic.playbackUrl} preload="metadata" onError={roomMusic.onAudioError} />
    <ResizablePanelGroup orientation="horizontal" className="min-h-0 min-w-0 flex-1" style={{height: 'auto'}}>
     <ResizablePanel
      id="channels"
      data-voice-left=""
      defaultSize="346px"
      minSize="210px"
      maxSize="552px"
      groupResizeBehavior="preserve-pixel-size"
     >
      <div
       className={
        'flex h-full min-h-0 flex-col overflow-hidden' +
        (messages.voiceLayout ? ' bg-background/75 backdrop-blur-sm' : '')
       }
      >
       <div className="flex min-h-0 flex-1">
        <ChatServerRail state={chat.state} nav={nav} panels={panels} />
        <ChatSidebar state={chat.state} nav={nav} panels={panels} calls={calls} call={call} />
       </div>
       <ChatProfileControls state={chat.state} panels={panels} call={call} />
      </div>
     </ResizablePanel>
     <ResizableHandle data-voice-left="" aria-label="Ширина списка каналов" />
     <ResizablePanel id="conversation" minSize="55%" className="flex min-h-0 flex-col" style={{overflow: 'hidden'}}>
      <AttachmentDropZone
       channel={nav.channel?.id}
       className={messages.voiceLayout ? 'bg-transparent' : undefined}
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
       <div className={expandedVoice ? 'hidden' : 'contents'}>
        <ChatHeader
         chat={chat}
         nav={nav}
         panels={panels}
         messages={messages}
         calls={calls}
         call={call}
         infoTrigger={infoTrigger}
         materialsTrigger={materialsTrigger}
         voiceChat={stageRoom ? {open: voiceChatOpen, toggle: toggleVoiceChat} : undefined}
        />
       </div>
       <ChatWorkspace
        chat={chat}
        state={chat.state}
        nav={nav}
        panels={panels}
        messages={messages}
        call={call}
        music={!nav.home ? roomMusic : undefined}
        stageRoom={stageRoom}
        expandedVoice={expandedVoice}
        voiceChatOpen={voiceChatOpen}
        voiceExpandButton={voiceExpandButton}
        onToggleVoiceExpanded={() => {
         setExpandedRoom(expandedVoice ? undefined : stageRoom);
         setExpandedChatOpen(false);
        }}
        onToggleVoiceChat={toggleVoiceChat}
        composerRef={composerRef}
        forwardCommentRef={forwardCommentRef}
        motionRef={conversationMotion}
        onCloseMaterials={closeMaterials}
        onJump={jumpToMessage}
       />
      </AttachmentDropZone>
     </ResizablePanel>
    </ResizablePanelGroup>
    <ChatSettingsModal
     chat={chat}
     state={chat.state}
     panels={panels}
     call={call}
     panelRef={settingsMotion}
     appearanceSettings={appearanceSettings}
    />
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
