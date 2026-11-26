import {
 Component,
 useCallback,
 useEffect,
 useLayoutEffect,
 useMemo,
 useRef,
 useState,
 type ReactNode,
 type RefObject
} from 'react';
import {ChevronDown} from 'lucide-react';
import {BotImageActivity, BotTyping} from '@/features/bots';
import {useMessageReadState} from '@/entities/message';
import {
 MessageScroller,
 MessageScrollerButton,
 MessageScrollerContent,
 MessageScrollerItem,
 MessageScrollerProvider,
 MessageScrollerViewport,
 useMessageScroller,
 useMessageScrollerScrollable
} from '@/shared/ui/message-scroller';
import type {ChatMessage, ChatState} from '@/shared/types';
import {Skeleton} from '@/shared/ui/skeleton';
import {MessageItem} from './message-item';
import {Friends} from './friends';
import type {ChatNavigationModel} from '../model/use-chat-navigation';
import type {ChatMessagesModel} from '../model/use-chat-messages';
import type {ChatStateModel} from '../model/use-chat-state';
import {conversationEmptyText, dayLabel, memberName, startsDay, unreadBadge, unreadLabel} from '../model/chat-rules';
import {createMessageRowSelector} from '../model/message-item';
import {groupMessages} from '../model/message-item-rules';
import {chatMessagesActions} from '../model/chat-messages';
import {chatHistoryActions} from '../model/chat-history';
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
 hidden?: boolean;
};

function ChatLoading({history = false}: {history?: boolean}) {
 const [show, setShow] = useState(false);
 useEffect(() => {
  const timer = setTimeout(() => setShow(true), 200);
  return () => clearTimeout(timer);
 }, []);
 if (!show) return null;
 return (
  <div role="status" className={history ? 'flex w-full items-center gap-2' : 'grid max-w-lg gap-4 p-4'}>
   <span className="sr-only">{history ? 'Загружаются более ранние сообщения' : 'Загружается чат'}</span>
   {history ? (
    <>
     <Skeleton className="size-5 shrink-0 rounded-full" />
     <Skeleton className="h-3 w-28 rounded-full" />
    </>
   ) : (
    ['w-3/5', 'w-2/5', 'w-3/4'].map(width => (
     <div key={width} className="flex items-end gap-2">
      <Skeleton className="size-7 shrink-0 rounded-full" />
      <Skeleton className={'h-10 rounded-xl ' + width} />
     </div>
    ))
   )}
  </div>
 );
}

export function ChatTranscript(props: Props) {
 const {chat, state, nav, messages} = props;
 const {channel, friends} = nav;
 const {search, voiceLayout} = messages;
 if (!state)
  return (
   <div className="min-h-0 flex-1 overflow-hidden" aria-busy={!chat.error}>
    {!chat.error && <ChatLoading />}
   </div>
  );
 if (friends)
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

function TranscriptScroller({chat, state, nav, messages, hidden}: Props) {
 const {home, channel, title} = nav;
 const {visibleMessages, jumpTarget, jumpEpoch, search, history, voiceLayout} = messages;
 const {hasMore, loading, error, loadOlder} = history;
 const viewport = useRef<HTMLDivElement>(null);
 useMessageReadState(viewport, state, channel?.id || '', messages.readsBlocked || !!hidden);
 const latestActions = useRef(messages.actions);
 useLayoutEffect(() => {
  latestActions.current = messages.actions;
 }, [messages.actions]);
 // Stable row handlers use the current page when resolving a quote.
 const handlers = useMemo(
  () => ({
   reply: (message: ChatMessage) => latestActions.current.replyTo(message),
   forward: (message: ChatMessage) => latestActions.current.openForwardPicker(message),
   jump: (id: string) => latestActions.current.jumpToQuote(id),
   retry: (id: string) => latestActions.current.retry(id)
  }),
  []
 );
 const historyMarker = useRef<HTMLDivElement>(null);
 const rows = useRef<HTMLDivElement>(null);
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

 const [selectRowState] = useState(createMessageRowSelector);
 const rowState = useMemo(() => state && selectRowState(state, channel?.id), [selectRowState, state, channel?.id]);
 const users = rowState?.users;
 const userName = useCallback((id: string) => memberName(users ?? [], id), [users]);
 const {refresh, setError} = chat.actions;
 const {outbox} = messages;
 const messageRows = useMemo(() => {
  if (!rowState) return null;
  let rowIndex = 0;
  return groupMessages(visibleMessages).flatMap(group => {
   const showDay = startsDay(visibleMessages, rowIndex);
   rowIndex += group.length;
   return group.map((message, index) => (
    <MessageScrollerItem
     key={message.id}
     messageId={message.id}
     className={`[content-visibility:visible] ${index ? 'mt-2' : ''} ${jumpTarget === message.id ? 'message-jump-highlight' : ''}`}
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
      state={rowState}
      refresh={refresh}
      onError={setError}
      userName={userName}
      onReply={references ? handlers.reply : undefined}
      onForward={references ? handlers.forward : undefined}
      onJump={handlers.jump}
      pending={outbox[message.id]?.status}
      pendingError={outbox[message.id]?.error}
      onRetry={outbox[message.id]?.status === 'failed' ? () => void handlers.retry(message.id) : undefined}
     />
    </MessageScrollerItem>
   ));
  });
 }, [rowState, visibleMessages, jumpTarget, userName, refresh, setError, references, handlers, outbox]);
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
         {historyLoadingVisible(history) && <ChatLoading history />}
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
     <TranscriptRows rows={rows} viewport={viewport} firstId={visibleMessages[0]?.id}>
      {messageRows}
     </TranscriptRows>
     {state && channel && !search && (
      <MessageScrollerItem className="[content-visibility:visible]">
       <BotImageActivity state={state} channel={channel.id} />
       {voiceLayout && !messages.imageActivityVisible && <BotTyping state={state} channel={channel.id} />}
      </MessageScrollerItem>
     )}
    </MessageScrollerContent>
   </MessageScrollerViewport>
   {storageKey && channel && !hidden && (
    <TranscriptBookmark
     rows={rows}
     viewport={viewport}
     storageKey={storageKey}
     channel={channel.id}
     messages={visibleMessages}
     historyError={error}
     jumpTarget={jumpTarget}
    />
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

type RowRefs = {rows: RefObject<HTMLDivElement | null>; viewport: RefObject<HTMLDivElement | null>};

function firstVisibleRow(rows: HTMLDivElement, viewport: HTMLDivElement) {
 const top = viewport.getBoundingClientRect().top;
 let lo = 0;
 let hi = rows.children.length;
 while (lo < hi) {
  const mid = (lo + hi) >>> 1;
  if (rows.children[mid].getBoundingClientRect().bottom <= top) lo = mid + 1;
  else hi = mid;
 }
 return rows.children[lo] as HTMLElement | undefined;
}

type RowsProps = RowRefs & {firstId?: string; children: ReactNode};
type Anchor = {id: string; top: number};

// Capture the reading position immediately before React changes the DOM, even if the user scrolled during the request.
class TranscriptRows extends Component<RowsProps, object, Anchor | null> {
 getSnapshotBeforeUpdate(previous: RowsProps): Anchor | null {
  const {rows, viewport, firstId} = this.props;
  if (!previous.firstId || previous.firstId === firstId || !rows.current || !viewport.current) return null;
  const root = viewport.current;
  if (root.scrollHeight - root.clientHeight - root.scrollTop <= 1) return null;
  const row = firstVisibleRow(rows.current, root)?.querySelector<HTMLElement>('[data-read-message-id]');
  return row?.dataset.readMessageId ? {id: row.dataset.readMessageId, top: row.getBoundingClientRect().top} : null;
 }

 componentDidUpdate(_previous: RowsProps, _state: object, anchor: Anchor | null) {
  if (!anchor) return;
  const {rows, viewport} = this.props;
  const row = rows.current?.querySelector<HTMLElement>(`[data-read-message-id="${CSS.escape(anchor.id)}"]`);
  if (row) viewport.current?.scrollBy({top: row.getBoundingClientRect().top - anchor.top, behavior: 'instant'});
 }

 render() {
  return (
   <div ref={this.props.rows} className="flex min-w-0 flex-col">
    {this.props.children}
   </div>
  );
 }
}

function readBookmark(storageKey: string) {
 try {
  const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
  if (typeof saved?.id === 'string' && saved.id) {
   return {id: saved.id.replace(/^group:/, ''), offset: Number.isFinite(saved.offset) ? Number(saved.offset) : null};
  }
 } catch {
  // Storage is optional.
 }
 return null;
}

function TranscriptBookmark({
 storageKey,
 channel,
 messages,
 historyError,
 jumpTarget,
 rows,
 viewport
}: RowRefs & {
 storageKey: string;
 channel: string;
 messages: readonly ChatMessage[];
 historyError: string;
 jumpTarget: string;
}) {
 const {scrollToMessage} = useMessageScroller();
 const {end} = useMessageScrollerScrollable();
 const [pending, setPending] = useState(() => readBookmark(storageKey));
 const hasTarget = pending && messages.some(message => message.id === pending.id);
 const ready = messages.length > 0;

 useEffect(() => {
  const root = viewport.current;
  if (!pending || !root) return;
  if (jumpTarget) {
   setPending(null);
   return;
  }
  const request = new AbortController();
  const {signal} = request;
  const current = () => !signal.aborted && root.isConnected;
  const cancel = () => {
   request.abort();
   setPending(null);
  };
  const onKey = (event: KeyboardEvent) => {
   if (event.key === ' ' && event.target instanceof Element && event.target.closest('button')) return;
   if (['ArrowDown', 'ArrowUp', 'End', 'Home', 'PageDown', 'PageUp', ' '].includes(event.key)) cancel();
  };
  const onPointer = (event: PointerEvent) => {
   if (event.target === root || event.button === 1) cancel();
  };
  const onClick = (event: MouseEvent) => {
   if (
    event.target instanceof Element &&
    event.target.closest('.message-reference,[data-slot="message-scroller-button"]')
   )
    cancel();
  };
  root.addEventListener('wheel', cancel, {passive: true, signal});
  root.addEventListener('touchmove', cancel, {passive: true, signal});
  root.addEventListener('keydown', onKey, {signal});
  root.addEventListener('pointerdown', onPointer, {signal});
  root.parentElement?.addEventListener('click', onClick, {signal});
  if (hasTarget) {
   // Measure after React has committed the row and the fonts have settled its line heights.
   void document.fonts.ready.then(() => {
    if (!current()) return;
    const row = rows.current?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(pending.id)}"]`);
    if (!row || !scrollToMessage(pending.id, {align: 'start', behavior: 'instant'})) return;
    if (pending.offset !== null)
     root.scrollBy({
      top: row.getBoundingClientRect().top - root.getBoundingClientRect().top - pending.offset,
      behavior: 'instant'
     });
    cancel();
   });
  } else if (!historyError)
   void chatHistoryActions.findMessage(channel, pending.id, current).then(
    found => {
     if (!found && current()) {
      try {
       localStorage.removeItem(storageKey);
      } catch {
       // Storage is optional.
      }
      cancel();
     }
    },
    () => {
     // Keep the bookmark through a network error. The history retry clears historyError.
    }
   );
  return () => request.abort();
 }, [channel, pending, hasTarget, historyError, jumpTarget, rows, viewport, scrollToMessage, storageKey]);

 useEffect(() => {
  const root = viewport.current;
  const list = rows.current;
  if (!root || !list || !ready || jumpTarget || pending) return;
  let timer: ReturnType<typeof setTimeout>;
  const schedule = () => {
   clearTimeout(timer);
   timer = setTimeout(() => {
    try {
     const row = end ? firstVisibleRow(list, root) : undefined;
     if (end && !row) return;
     const bookmark = row
      ? {id: row.dataset.messageId, offset: row.getBoundingClientRect().top - root.getBoundingClientRect().top}
      : {bottom: true};
     localStorage.setItem(storageKey, JSON.stringify(bookmark));
    } catch {
     // Storage is optional.
    }
   }, 300);
  };
  schedule();
  root.addEventListener('scroll', schedule, {passive: true});
  return () => {
   clearTimeout(timer);
   root.removeEventListener('scroll', schedule);
  };
 }, [storageKey, end, ready, jumpTarget, pending, rows, viewport]);

 return null;
}
