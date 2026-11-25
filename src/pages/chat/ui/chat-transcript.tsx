import {useEffect, useMemo, useRef} from 'react';
import {ChevronDown} from 'lucide-react';
import {BotImageActivity, BotTyping} from '@/features/bots';
import {MessageGroup} from '@/shared/ui/message';
import {
 MessageScroller,
 MessageScrollerButton,
 MessageScrollerContent,
 MessageScrollerItem,
 MessageScrollerProvider,
 MessageScrollerViewport,
 useMessageScroller,
 useMessageScrollerScrollable,
 useMessageScrollerVisibility
} from '@/shared/ui/message-scroller';
import type {ChatState} from '@/shared/types';
import {MessageItem} from './message-item';
import {Friends} from './friends';
import type {ChatNavigationModel} from '../model/use-chat-navigation';
import type {ChatMessagesModel} from '../model/use-chat-messages';
import type {ChatStateModel} from '../model/use-chat-state';
import {conversationEmptyText, dayLabel, startsDay, unreadBadge, unreadLabel} from '../model/chat-rules';
import {groupMessages} from '../model/message-item-rules';
import {chatMessagesActions} from '../model/chat-messages';
import {
 historyButtonVisible,
 historyErrorText,
 historyLoadingVisible,
 historyRetryVisible
} from '../model/chat-history-rules';

type Props = {
 chat: ChatStateModel;
 state: ChatState | null;
 nav: ChatNavigationModel;
 messages: ChatMessagesModel;
};

export function ChatTranscript(props: Props) {
 const {chat, state, nav, messages} = props;
 const {channel, friends} = nav;
 const {search, voiceLayout} = messages;
 if (friends && state)
  return (
   <Friends
    state={state}
    refresh={chat.actions.refresh}
    onError={chat.actions.setError}
    onDialog={nav.actions.openDialog}
   />
  );
 const key = JSON.stringify([state?.me.id, channel?.id, search]);
 return (
  <>
   <MessageScrollerProvider
    key={`${key}:${voiceLayout}`}
    autoScroll={!search}
    defaultScrollPosition={search ? 'start' : 'end'}
   >
    <TranscriptScroller {...props} />
   </MessageScrollerProvider>
  </>
 );
}

function TranscriptScroller({chat, state, nav, messages}: Props) {
 const {home, channel, title} = nav;
 const {visibleMessages, jumpTarget, jumpEpoch, search, history, voiceLayout} = messages;
 const {hasMore, loading, error, loadOlder} = history;
 const viewport = useRef<HTMLDivElement>(null);
 const historyMarker = useRef<HTMLDivElement>(null);
 const historyVisible = !!state && !!channel && !search;
 const references = messages.referencesSupported && !chat.busy;
 const {scrollToMessage} = useMessageScroller();
 const storageKey =
  state && channel && !search ? `sombra-chat-scroll-v1:${JSON.stringify([state.me.id, channel.id])}` : '';

 useEffect(() => {
  if (!jumpTarget) return;
  scrollToMessage(jumpTarget, {
   align: 'center',
   behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'
  });
  const timer = setTimeout(() => chatMessagesActions.clearJump(), 2500);
  return () => clearTimeout(timer);
 }, [jumpTarget, jumpEpoch, scrollToMessage]);

 useEffect(() => {
  const root = viewport.current;
  const marker = historyMarker.current;
  if (!root || !marker || !historyVisible || !hasMore || loading || error) return;
  const observer = new IntersectionObserver(
   entries => {
    if (!entries.some(entry => entry.isIntersecting)) return;
    observer.disconnect();
    loadOlder();
   },
   {root}
  );
  observer.observe(marker);
  return () => observer.disconnect();
 }, [historyVisible, hasMore, loading, error, loadOlder]);

 const groups = useMemo(() => groupMessages(visibleMessages), [visibleMessages]);
 let rowIndex = 0;
 return (
  <MessageScroller className={voiceLayout ? 'voice-messages flex-1' : 'chat-message-scroller flex-1'}>
   <MessageScrollerViewport
    ref={viewport}
    className="message-scroll"
    aria-label={voiceLayout ? 'Сообщения голосового канала' : 'Сообщения'}
   >
    <MessageScrollerContent className="gap-0 p-4">
     {voiceLayout && (
      <MessageScrollerItem>
       <h3>Чат канала · {title}</h3>
      </MessageScrollerItem>
     )}
     {historyVisible && (
      <MessageScrollerItem className="[content-visibility:visible]">
       {(hasMore || loading || error) && (
        <div className="chat-history flex min-h-[30px] flex-none items-center justify-center py-[2px]">
         {historyButtonVisible(history) && (
          <button type="button" className="chat-history-button text-primary text-xs" onClick={loadOlder}>
           Показать более ранние
          </button>
         )}
         {historyLoadingVisible(history) && (
          <span className="text-muted-foreground text-xs" role="status">
           Загрузка…
          </span>
         )}
         {historyRetryVisible(history) && (
          <span className="text-destructive flex flex-wrap items-center justify-center gap-2 text-xs" role="alert">
           {historyErrorText(history.error)}
           <button type="button" className="chat-history-button text-primary" onClick={loadOlder}>
            Повторить
           </button>
          </span>
         )}
        </div>
       )}
       <div ref={historyMarker} className="pointer-events-none h-px" aria-hidden="true" />
      </MessageScrollerItem>
     )}
     {!visibleMessages.length && (
      <MessageScrollerItem>
       <p className="text-muted-foreground py-3 text-sm">
        {search
         ? 'Сообщения не найдены'
         : !channel && home && state
           ? 'Выберите переписку слева или начните новый диалог кнопкой +.'
           : conversationEmptyText(!!channel)}
       </p>
      </MessageScrollerItem>
     )}
     {state &&
      groups.map(group => {
       const showDay = startsDay(visibleMessages, rowIndex);
       rowIndex += group.length;
       // The scroller measures direct group rows; nested IDs keep individual messages addressable.
       return (
        <MessageScrollerItem
         key={group[0].id}
         messageId={`group:${group[0].id}`}
         className="[content-visibility:visible]"
        >
         <MessageGroup>
          {group.map((message, index) => (
           <MessageScrollerItem
            key={message.id}
            messageId={message.id}
            className={
             jumpTarget === message.id
              ? 'message-jump-highlight [content-visibility:visible]'
              : '[content-visibility:visible]'
            }
           >
            {!index && showDay && (
             <div className="chat-day text-muted-foreground mt-[10px] mb-[6px] flex justify-center text-[11px]">
              <span className="rounded-[20px] px-[10px] py-1">{dayLabel(message.time)}</span>
             </div>
            )}
            <MessageItem
             previous={group[index - 1]}
             showAvatar={index === group.length - 1}
             message={message}
             state={state}
             refresh={chat.actions.refresh}
             onError={chat.actions.setError}
             userName={nav.userName}
             onReply={references ? messages.actions.replyTo : undefined}
             onForward={references ? messages.actions.openForwardPicker : undefined}
             onJump={messages.actions.jumpToQuote}
             pending={messages.outbox[message.id]?.status}
             pendingError={messages.outbox[message.id]?.error}
             onRetry={() => void messages.actions.retry(message.id)}
            />
           </MessageScrollerItem>
          ))}
         </MessageGroup>
        </MessageScrollerItem>
       );
      })}
     {state && channel && !search && (
      <MessageScrollerItem className="[content-visibility:visible]">
       <BotImageActivity state={state} channel={channel.id} />
       {voiceLayout && !messages.imageActivityVisible && <BotTyping state={state} channel={channel.id} />}
      </MessageScrollerItem>
     )}
    </MessageScrollerContent>
   </MessageScrollerViewport>
   {storageKey && (
    <TranscriptBookmark storageKey={storageKey} ready={visibleMessages.length > 0} jumpTarget={jumpTarget} />
   )}
   {channel && !search && (
    <MessageScrollerButton aria-label="В конец чата" className="chat-transcript-scroll-button">
     <ChevronDown aria-hidden="true" />
     {(channel.unreadCount ?? 0) > 0 && (
      <span className="chat-scroll-unread" aria-label={unreadLabel(channel.unreadCount)}>
       {unreadBadge(channel.unreadCount!)}
      </span>
     )}
    </MessageScrollerButton>
   )}
  </MessageScroller>
 );
}

function TranscriptBookmark({storageKey, ready, jumpTarget}: {storageKey: string; ready: boolean; jumpTarget: string}) {
 const {scrollToMessage} = useMessageScroller();
 const {end} = useMessageScrollerScrollable();
 const {visibleMessageIds} = useMessageScrollerVisibility();
 const restored = useRef(false);

 useEffect(() => {
  if (!storageKey || !ready || restored.current) return;
  restored.current = true;
  if (jumpTarget) return;
  try {
   const saved = JSON.parse(localStorage.getItem(storageKey) || 'null') as {id?: string} | null;
   if (typeof saved?.id === 'string') scrollToMessage(saved.id, {align: 'start', behavior: 'instant'});
  } catch {
   // Storage is optional.
  }
 }, [storageKey, ready, jumpTarget, scrollToMessage]);

 useEffect(() => {
  if (!storageKey || !visibleMessageIds.length || jumpTarget) return;
  // Save on the next scroll-state transition, not while the initial restoration is settling.
  const timer = setTimeout(() => {
   try {
    localStorage.setItem(storageKey, JSON.stringify(end ? {id: visibleMessageIds[0]} : {bottom: true}));
   } catch {
    // Storage is optional.
   }
  }, 300);
  return () => clearTimeout(timer);
 }, [storageKey, end, visibleMessageIds, jumpTarget]);

 return null;
}
