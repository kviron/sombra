import {ColumnResizer} from '@/shared/ui/column-resizer';
import {ConversationMaterials} from '@/features/conversation-details';
import type {useRoomMusic, Voice} from '@/features/voice-room';
import type {RefObject} from 'react';
import type {useScreenGlitch} from '@/shared/ui/use-screen-glitch';
import type {ChatState} from '@/shared/types';
import {MemberList} from './member-list';
import {ChatComposer} from './chat-composer';
import {ChatTranscript} from './chat-transcript';
import type {ChatNavigationModel} from '../model/use-chat-navigation';
import type {ChatPanelsModel} from '../model/use-chat-panels';
import type {ChatMessagesModel} from '../model/use-chat-messages';
import type {ChatStateModel} from '../model/use-chat-state';
import type {useChatScroll} from '../lib/use-chat-scroll';

type Props = {
 chat: ChatStateModel;
 state: ChatState | null;
 nav: ChatNavigationModel;
 panels: ChatPanelsModel;
 messages: ChatMessagesModel;
 call: Voice;
 music: ReturnType<typeof useRoomMusic> | undefined;
 scroll: ReturnType<typeof useChatScroll>;
 scrollRef: RefObject<HTMLDivElement | null>;
 scrollKey: string;
 voiceRoom: string | undefined;
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
 scroll,
 scrollRef,
 scrollKey,
 voiceRoom,
 composerRef,
 forwardCommentRef,
 motionRef,
 onCloseMaterials,
 onJump
}: Props) {
 const {channel} = nav;
 return (
  <div className="conversation-body flex min-h-0 flex-1" ref={motionRef}>
   <div
    className={
     messages.voiceLayout
      ? 'chat-main voice-layout relative flex min-w-0 flex-1 flex-col'
      : 'chat-main relative flex min-w-0 flex-1 flex-col'
    }
   >
    {messages.voiceLayout && (
     <ColumnResizer
      label="Ширина чата канала"
      side="left"
      variable="--voice-chat-width"
      min={260}
      max={600}
      target=".voice-messages"
     />
    )}
    <ChatTranscript
     chat={chat}
     state={state}
     nav={nav}
     panels={panels}
     messages={messages}
     call={call}
     music={music}
     scroll={scroll}
     scrollRef={scrollRef}
     scrollKey={scrollKey}
     voiceRoom={voiceRoom}
    />
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
   {!panels.materialsOpen && nav.canShowMembers && panels.members && (
    <aside className="member-list border-l" aria-label="Участники">
     <ColumnResizer label="Ширина списка участников" side="left" variable="--member-width" min={180} max={420} />
     {state && nav.group ? (
      <MemberList members={nav.group.members} users={state.users} meId={state.me.id} group={nav.group} />
     ) : (
      <p className="member-empty">Загрузка участников…</p>
     )}
    </aside>
   )}
   {panels.materialsOpen && channel && !nav.friends && state && (
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
