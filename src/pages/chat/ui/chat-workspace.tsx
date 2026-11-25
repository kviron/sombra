import {TooltipLabel} from '@/shared/ui/tooltip';
import {useSyncExternalStore, type RefObject} from 'react';
import {ResizableHandle, ResizablePanel, ResizablePanelGroup} from '@/shared/ui/resizable';
import {Button} from '@/shared/ui/button';
import {MotionIcon} from '@/shared/ui/motion-icon';
import {Maximize, MessageCircle, Minimize, Volume2} from 'lucide-react';
import {ConversationMaterials} from '@/features/conversation-details';
import {VoiceStage, type RoomMusicModel, type Voice} from '@/features/voice-room';
import type {useScreenGlitch} from '@/shared/ui/use-screen-glitch';
import type {ChatState} from '@/shared/types';
import {MemberList} from './member-list';
import {ChatComposer} from './chat-composer';
import {ChatTranscript} from './chat-transcript';
import type {ChatNavigationModel} from '../model/use-chat-navigation';
import type {ChatPanelsModel} from '../model/use-chat-panels';
import type {ChatMessagesModel} from '../model/use-chat-messages';
import type {ChatStateModel} from '../model/use-chat-state';

function subscribeViewport(onChange: () => void) {
 const voice = window.matchMedia('(max-width: 1000px)');
 const members = window.matchMedia('(max-width: 760px)');
 voice.addEventListener('change', onChange);
 members.addEventListener('change', onChange);
 return () => {
  voice.removeEventListener('change', onChange);
  members.removeEventListener('change', onChange);
 };
}

function viewportMode() {
 return window.matchMedia('(max-width: 760px)').matches
  ? 'small'
  : window.matchMedia('(max-width: 1000px)').matches
    ? 'narrow'
    : 'wide';
}

type Props = {
 chat: ChatStateModel;
 state: ChatState | null;
 nav: ChatNavigationModel;
 panels: ChatPanelsModel;
 messages: ChatMessagesModel;
 call: Voice;
 music: RoomMusicModel | undefined;
 stageRoom: string | undefined;
 expandedVoice: boolean;
 voiceChatOpen: boolean;
 voiceExpandButton: RefObject<HTMLButtonElement | null>;
 onToggleVoiceExpanded: () => void;
 onToggleVoiceChat: () => void;
 composerRef: RefObject<HTMLDivElement | null>;
 forwardCommentRef: RefObject<HTMLTextAreaElement | null>;
 motionRef: ReturnType<typeof useScreenGlitch>;
 onCloseMaterials: () => void;
 onJump: (id: string, fromMaterials?: boolean) => void;
};

/** Правая колонка под шапкой: транскрипт, поле ввода, участники и материалы переписки. */
export function ChatWorkspace({
 chat,
 state,
 nav,
 panels,
 messages,
 call,
 music,
 stageRoom,
 expandedVoice,
 voiceChatOpen,
 voiceExpandButton,
 onToggleVoiceExpanded,
 onToggleVoiceChat,
 composerRef,
 forwardCommentRef,
 motionRef,
 onCloseMaterials,
 onJump
}: Props) {
 const {channel} = nav;
 const mode = useSyncExternalStore(subscribeViewport, viewportMode, () => 'wide');
 const voiceVertical = !expandedVoice && mode !== 'wide';
 const showMembers = mode !== 'small' && !panels.materialsOpen && nav.canShowMembers && panels.members;
 const expandLabel = expandedVoice ? 'Выйти из полноэкранного режима' : 'Развернуть на весь экран';
 const chatLabel = voiceChatOpen ? 'Скрыть чат комнаты' : 'Открыть чат комнаты';
 const conversation = (
  <div
   className={
    messages.voiceLayout
     ? 'chat-main voice-layout relative flex h-full min-h-0 min-w-0 flex-col'
     : 'chat-main relative flex h-full min-h-0 min-w-0 flex-col'
   }
  >
   <ChatTranscript chat={chat} state={state} nav={nav} messages={messages} />
   <ChatComposer
    chat={chat}
    state={state}
    nav={nav}
    panels={panels}
    messages={messages}
    composerRef={composerRef}
    forwardCommentRef={forwardCommentRef}
   />
  </div>
 );
 return (
  <div className="conversation-body flex min-h-0 flex-1" ref={motionRef}>
   <ResizablePanelGroup orientation="horizontal" className="min-h-0 min-w-0 flex-1" style={{height: 'auto'}}>
    <ResizablePanel id="chat-main" minSize="55%" className="flex min-h-0 flex-col" style={{overflow: 'hidden'}}>
     {messages.voiceLayout && stageRoom ? (
      <ResizablePanelGroup
       orientation={voiceVertical ? 'vertical' : 'horizontal'}
       data-voice-chat-hidden={!voiceChatOpen || undefined}
      >
       <ResizablePanel
        id="voice-stage"
        minSize={voiceVertical ? '45%' : '35%'}
        className="voice-stage-panel @container relative flex"
        style={{overflow: 'clip'}}
       >
        <VoiceStage
         music={music}
         voice={call}
         id={stageRoom}
         presence={state?.voicePresence?.[stageRoom]}
         title={nav.title}
         userName={nav.userName}
         me={state?.me.name || 'Вы'}
         meUser={state?.me}
         users={state?.users}
         onSettings={() => panels.actions.openSettings('voice')}
        />
        {expandedVoice && (
         <div className="pointer-events-none absolute inset-x-3 top-3 flex items-center justify-between gap-2">
          <span className="text-muted-foreground flex min-w-0 items-center gap-2 text-sm">
           <Volume2 className="size-4 shrink-0" aria-hidden="true" />
           <span className="truncate">{nav.title}</span>
          </span>
          <TooltipLabel content={chatLabel}>
           <Button
            type="button"
            variant="secondary"
            size="icon-lg"
            className="pointer-events-auto shrink-0"
            aria-label={chatLabel}
            aria-expanded={voiceChatOpen}
            aria-controls="voice-chat"
            onClick={onToggleVoiceChat}
           >
            <MotionIcon icon={MessageCircle} />
           </Button>
          </TooltipLabel>
         </div>
        )}
        {call.room === stageRoom && (
         <TooltipLabel content={expandLabel}>
          <Button
           ref={voiceExpandButton}
           type="button"
           variant="secondary"
           size="icon-lg"
           className="border-border bg-card/70 hover:bg-card/85 absolute right-3 bottom-3 rounded-xl shadow-sm backdrop-blur-md motion-safe:transition-[opacity,transform,background-color] motion-safe:duration-200 motion-safe:ease-out @max-[24rem]:bottom-18"
           data-auto-hide
           aria-label={expandLabel}
           onClick={onToggleVoiceExpanded}
          >
           <MotionIcon icon={expandedVoice ? Minimize : Maximize} />
          </Button>
         </TooltipLabel>
        )}
       </ResizablePanel>
       <ResizableHandle data-voice-chat="" aria-label={voiceVertical ? 'Высота чата канала' : 'Ширина чата канала'} />
       <ResizablePanel
        id="voice-chat"
        data-voice-chat=""
        defaultSize={voiceVertical ? '40%' : '340px'}
        minSize={voiceVertical ? '25%' : '180px'}
        maxSize={voiceVertical ? '55%' : '600px'}
        groupResizeBehavior={voiceVertical ? 'preserve-relative-size' : 'preserve-pixel-size'}
        className="bg-card/75 flex min-h-0 flex-col backdrop-blur-sm"
        style={{overflow: 'hidden'}}
       >
        {conversation}
       </ResizablePanel>
      </ResizablePanelGroup>
     ) : (
      conversation
     )}
    </ResizablePanel>
    {showMembers && (
     <>
      <ResizableHandle data-voice-auxiliary="" aria-label="Ширина списка участников" />
      <ResizablePanel
       id="chat-members"
       data-voice-auxiliary=""
       defaultSize="210px"
       minSize="150px"
       maxSize="420px"
       groupResizeBehavior="preserve-pixel-size"
      >
       <aside className="member-list h-full" aria-label="Участники">
        {state && nav.group ? (
         <MemberList members={nav.group.members} users={state.users} meId={state.me.id} group={nav.group} />
        ) : (
         <p className="member-empty">Загрузка участников…</p>
        )}
       </aside>
      </ResizablePanel>
     </>
    )}
   </ResizablePanelGroup>
   {!expandedVoice && panels.materialsOpen && channel && !nav.friends && state && (
    <ConversationMaterials
     key={`${channel.id}:${panels.materialsEpoch}`}
     initialCategory={panels.materialsCategory}
     channel={channel.id}
     title={nav.title}
     messages={state.messages}
     userName={nav.userName}
     onClose={onCloseMaterials}
     onJump={onJump}
    />
   )}
  </div>
 );
}
