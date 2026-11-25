import {useEffect, useMemo, useRef} from 'react';
import type {ChatState} from '@/shared/types';
import {messageService} from './services/message-service';

/** Long messages use the viewport as denominator, not their entire height. */
export function sufficientlyVisible(height: number, visible: number, viewport: number) {
 return visible >= Math.min(40, height) && visible >= Math.min(height, viewport) * 0.5;
}

export function observeMessageReads({
 root,
 actor,
 channel,
 eligible,
 send,
 onRead,
 active = () => true
}: {
 root: HTMLElement;
 actor: string;
 channel: string;
 eligible: Set<string>;
 send: (ids: string[]) => Promise<unknown>;
 onRead?: (ids: string[]) => void;
 active?: () => boolean;
}) {
 let disposed = false,
  inflight = false;
 const completed = new Set<string>(),
  queued = new Set<string>(),
  visible = new Set<string>(),
  timers = new Map<string, ReturnType<typeof setTimeout>>();
 let batch: ReturnType<typeof setTimeout> | undefined;
 const allowed = () =>
  !disposed &&
  active() &&
  document.visibilityState === 'visible' &&
  document.hasFocus() &&
  !document.querySelector('[role="dialog"],[data-slot="dialog-overlay"],[data-slot="alert-dialog-overlay"]');
 function stop() {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  queued.clear();
  if (batch) clearTimeout(batch);
  batch = undefined;
 }
 function dwell(id: string) {
  if (completed.has(id) || queued.has(id) || timers.has(id) || !allowed()) return;
  timers.set(
   id,
   setTimeout(() => {
    timers.delete(id);
    if (allowed() && visible.has(id)) {
     queued.add(id);
     schedule();
    }
   }, 500)
  );
 }
 function schedule() {
  if (!batch && !inflight)
   batch = setTimeout(() => {
    batch = undefined;
    void flush();
   }, 400);
 }
 async function flush() {
  if (!allowed()) {
   stop();
   return;
  }
  const ids = [...queued].filter(id => visible.has(id) && !completed.has(id)).slice(0, 100);
  ids.forEach(id => queued.delete(id));
  if (!ids.length) return;
  inflight = true;
  try {
   await send(ids);
   if (!disposed) {
    ids.forEach(id => {
     completed.add(id);
     queued.delete(id);
    });
    onRead?.(ids);
   }
  } catch {
   /* A failed batch remains eligible while visible. */
  } finally {
   inflight = false;
   if (!disposed) {
    for (const id of visible) dwell(id);
    if (queued.size) schedule();
   }
  }
 }
 const observer = new IntersectionObserver(
  entries => {
   for (const entry of entries) {
    const id = (entry.target as HTMLElement).dataset.readMessageId;
    if (!id || !root.contains(entry.target)) continue;
    const viewport = entry.rootBounds?.height || window.innerHeight;
    if (
     entry.isIntersecting &&
     sufficientlyVisible(entry.boundingClientRect.height, entry.intersectionRect.height, viewport)
    ) {
     visible.add(id);
     dwell(id);
    } else {
     visible.delete(id);
     queued.delete(id);
     const timer = timers.get(id);
     if (timer) clearTimeout(timer);
     timers.delete(id);
    }
   }
  },
  {root, threshold: Array.from({length: 101}, (_, i) => i / 100)}
 );
 const observed = new Set<HTMLElement>();
 const rowSelector = '[data-read-message-id]';
 function observeRow(element: HTMLElement) {
  if (!root.contains(element) || !eligible.has(element.dataset.readMessageId || '') || observed.has(element)) return;
  observed.add(element);
  observer.observe(element);
 }
 function unobserveRow(element: HTMLElement) {
  if (root.contains(element) || !observed.delete(element)) return;
  observer.unobserve(element);
  const id = element.dataset.readMessageId;
  if (!id) return;
  visible.delete(id);
  queued.delete(id);
  const timer = timers.get(id);
  if (timer) clearTimeout(timer);
  timers.delete(id);
 }
 function visitRows(node: Node, visit: (element: HTMLElement) => void) {
  if (!(node instanceof HTMLElement)) return;
  if (node.matches(rowSelector)) visit(node);
  node.querySelectorAll<HTMLElement>(rowSelector).forEach(visit);
 }
 // Changes elsewhere (menus, panels, typing) can pause reads but must not rescan the transcript.
 const mutation = new MutationObserver(records => {
  const inTranscript = records.filter(record => record.type === 'childList' && root.contains(record.target));
  for (const record of inTranscript) record.removedNodes.forEach(node => visitRows(node, unobserveRow));
  for (const record of inTranscript) record.addedNodes.forEach(node => visitRows(node, observeRow));
  attention();
 });
 mutation.observe(document.body, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['role', 'data-state']
 });
 root.querySelectorAll<HTMLElement>(rowSelector).forEach(observeRow);
 attention();
 function attention() {
  if (!allowed()) stop();
  else for (const id of visible) dwell(id);
 }
 const auth = () => {
  disposed = true;
  stop();
  observer.disconnect();
  mutation.disconnect();
 };
 window.addEventListener('authchange', auth);
 document.addEventListener('visibilitychange', attention);
 window.addEventListener('focus', attention);
 window.addEventListener('blur', attention);
 return () => {
  disposed = true;
  stop();
  observer.disconnect();
  mutation.disconnect();
  window.removeEventListener('authchange', auth);
  document.removeEventListener('visibilitychange', attention);
  window.removeEventListener('focus', attention);
  window.removeEventListener('blur', attention);
  void actor;
  void channel;
 };
}

export function useMessageReadState(
 state: ChatState | null,
 channel: string,
 blocked: boolean,
 onRead?: (ids: string[]) => void
) {
 const accepted = useRef(onRead);
 accepted.current = onRead;
 const actor = state?.me.id || '';
 const canRead = state?.readReceiptsSupported && !state.me.bot;
 const messages = state?.messages;
 const ids = useMemo(
  () =>
   messages
    ?.filter(m => m.channel === channel && m.user !== actor)
    .map(m => m.id)
    .join('\n') || '',
  [messages, actor, channel]
 );
 useEffect(() => {
  if (!canRead || !actor || !channel || blocked || typeof IntersectionObserver === 'undefined') return;
  const root = document.querySelector<HTMLElement>('[data-slot="message-scroller-viewport"]');
  if (!root) return;
  return observeMessageReads({
   root,
   actor,
   channel,
   eligible: new Set(ids.split('\n')),
   send: messages => messageService.markRead({channel, messages}),
   onRead: ids => accepted.current?.(ids)
  });
 }, [actor, channel, blocked, canRead, ids]);
}
