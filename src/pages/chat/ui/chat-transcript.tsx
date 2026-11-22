import {useCallback, useEffect, useLayoutEffect, useRef, type RefObject} from 'react';
import {ChevronDown} from 'lucide-react';
import {BotImageActivity, BotTyping} from '@/features/bots';
import {VoiceStage} from '@/features/voice-room';
import type {useRoomMusic, Voice} from '@/features/voice-room';
import {Button} from '@/shared/ui/button';
import type {ChatState} from '@/shared/types';
import {MessageItem} from './message-item';
import {Friends} from './friends';
import type {ChatNavigationModel} from '../model/use-chat-navigation';
import type {ChatPanelsModel} from '../model/use-chat-panels';
import type {ChatMessagesModel} from '../model/use-chat-messages';
import type {ChatStateModel} from '../model/use-chat-state';
import type {useChatScroll} from '../lib/use-chat-scroll';
import {conversationEmptyText, dayLabel, startsDay, unreadBadge, unreadLabel} from '../model/chat-rules';
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
 panels: ChatPanelsModel;
 messages: ChatMessagesModel;
 call: Voice;
 voiceRoom: string | undefined;
 music: ReturnType<typeof useRoomMusic> | undefined;
 scroll: ReturnType<typeof useChatScroll>;
 scrollRef: RefObject<HTMLDivElement | null>;
 scrollKey: string;
};

/** Транскрипт: друзья, голосовая сцена или сообщения плюс кнопка возврата вниз. */
export function ChatTranscript({
 chat,
 state,
 nav,
 panels,
 messages,
 call,
 voiceRoom,
 music,
 scroll,
 scrollRef,
 scrollKey
}: Props) {
 const {home, channel, title, friends} = nav;
 const end = useRef<HTMLDivElement>(null);
 const historyMarker = useRef<HTMLDivElement>(null);
 const historyAnchor = useRef<{channel: string; height: number} | null>(null);
 const {visibleMessages, jumpTarget, search, history} = messages;
 const {hasMore: historyMore, loading: historyLoading, error: historyError, loadOlder} = history;
 const references = messages.referencesSupported && !chat.busy;
 const historyVisible = !!state && !!channel && !search;
 const channelId = channel?.id || '';

 /** Высота до подстановки: после вставки старых сообщений прокрутка не должна дёргаться. */
 const rememberScroll = useCallback(() => {
  const root = scrollRef.current;
  if (root) historyAnchor.current = {channel: channelId, height: root.scrollHeight};
 }, [scrollRef, channelId]);

 function loadOlderHistory() {
  rememberScroll();
  loadOlder();
 }

 // Смена переписки: высота прошлого списка к новому неприменима.
 useLayoutEffect(() => {
  historyAnchor.current = null;
 }, [channelId]);

 // Любая загрузка (кнопка, прокрутка или автодогрузка) запоминает высоту до появления старых строк.
 useLayoutEffect(() => {
  if (historyLoading && historyAnchor.current === null) rememberScroll();
 }, [historyLoading, rememberScroll]);

 // Старые сообщения уже в DOM: у низа остаёмся у низа, иначе сохраняем строку на месте.
 useLayoutEffect(() => {
  const root = scrollRef.current;
  const anchor = historyAnchor.current;
  if (historyLoading || !root || !anchor || anchor.channel !== channelId) return;
  historyAnchor.current = null;
  // Пользователь следил за новыми сообщениями: догрузка не должна отрывать его от низа.
  if (scroll.sticky.current) {
   root.scrollTop = root.scrollHeight;
   return;
  }
  const grown = root.scrollHeight - anchor.height;
  if (grown > 0) root.scrollTop += grown;
 }, [historyLoading, channelId, scrollRef, scroll.sticky]);

 // Автодогрузка: невидимый маркер над первым сообщением, только у верха списка и без загрузки.
 useEffect(() => {
  const root = scrollRef.current;
  const marker = historyMarker.current;
  if (!root || !marker || !historyVisible || !historyMore || historyLoading || historyError) return;
  const observer = new IntersectionObserver(
   entries => {
    if (!entries.some(entry => entry.isIntersecting)) return;
    // Одно пересечение — одна страница: дальше сторож хранилища и пересоздание observer.
    observer.disconnect();
    rememberScroll();
    loadOlder();
   },
   {root, threshold: 0}
  );
  observer.observe(marker);
  return () => observer.disconnect();
 }, [scrollRef, historyVisible, historyMore, historyLoading, historyError, loadOlder, rememberScroll]);

 const rows = state
  ? visibleMessages.map((message, index) => (
     <div
      key={message.id}
      data-message-id={message.id}
      className={jumpTarget === message.id ? 'message-jump-highlight' : undefined}
     >
      {startsDay(visibleMessages, index) && (
       <div className="chat-day">
        <span>{dayLabel(message.time)}</span>
       </div>
      )}
      <MessageItem
       previous={visibleMessages[index - 1]}
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
     </div>
    ))
  : null;

 const historyBarVisible = historyVisible && (history.hasMore || history.loading || history.error);
 const historyControls = historyVisible ? (
  <>
   {historyBarVisible && (
    <div className="chat-history">
     {historyButtonVisible(history) && (
      <button type="button" className="chat-history-button" onClick={loadOlderHistory}>
       Показать более ранние
      </button>
     )}
     {historyLoadingVisible(history) && (
      <span className="chat-history-loading" role="status">
       Загрузка…
      </span>
     )}
     {historyRetryVisible(history) && (
      <span className="chat-history-error" role="alert">
       <span>{historyErrorText(history.error)}</span>
       <button type="button" className="chat-history-button" onClick={loadOlderHistory}>
        Повторить
       </button>
      </span>
     )}
    </div>
   )}
   <div ref={historyMarker} className="chat-history-marker" aria-hidden="true" />
  </>
 ) : null;

 return (
  <>
   {friends && state ? (
    <Friends
     state={state}
     refresh={chat.actions.refresh}
     onError={chat.actions.setError}
     onDialog={nav.actions.openDialog}
    />
   ) : messages.voiceLayout ? (
    <VoiceStage
     music={music}
     voice={call}
     id={voiceRoom || channel!.id}
     title={title}
     userName={nav.userName}
     me={state?.me.name || 'Вы'}
     meUser={state?.me}
     users={state?.users}
     onSettings={() => panels.actions.openSettings('voice')}
    />
   ) : (
    <div className="message-scroll" ref={scrollRef} tabIndex={-1} role="region" aria-label="Сообщения">
     {!channel && home && state ? (
      <p className="conversation-empty">Выберите переписку слева или начните новый диалог кнопкой +.</p>
     ) : (
      <>
       {historyControls}
       {!visibleMessages.length && !search && <p className="conversation-empty">{conversationEmptyText(!!channel)}</p>}
       {rows}
       {state && !search && channel && <BotImageActivity state={state} channel={channel.id} />}
      </>
     )}
     {search && !visibleMessages.length && <p className="no-results">Сообщения не найдены</p>}
     <div ref={end} />
    </div>
   )}
   {scroll.mode && scrollKey && (
    <Button
     type="button"
     variant="ghost"
     size="icon"
     className="chat-scroll-down"
     title={scroll.mode === 'read' ? 'К последнему прочитанному сообщению' : 'В конец чата'}
     aria-label={scroll.mode === 'read' ? 'К последнему прочитанному сообщению' : 'В конец чата'}
     onClick={scroll.goDown}
    >
     <ChevronDown aria-hidden="true" size={20} />
     {(channel?.unreadCount ?? 0) > 0 && (
      <span className="chat-scroll-unread" aria-label={unreadLabel(channel?.unreadCount)}>
       {unreadBadge(channel!.unreadCount!)}
      </span>
     )}
    </Button>
   )}
   {messages.voiceLayout && (
    <div
     className="voice-messages"
     ref={scrollRef}
     tabIndex={-1}
     role="region"
     aria-label="Сообщения голосового канала"
    >
     <h3>Чат канала · {title}</h3>
     {historyControls}
     {rows}
     {state && channel && (
      <>
       <BotImageActivity state={state} channel={channel.id} />
       {!messages.imageActivityVisible && <BotTyping state={state} channel={channel.id} />}
      </>
     )}
     <div ref={end} />
    </div>
   )}
  </>
 );
}
