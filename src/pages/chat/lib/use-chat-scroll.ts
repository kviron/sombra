import {useCallback, useLayoutEffect, useRef, useState, type RefObject} from 'react';

type Anchor = {id: string; offset: number} | {bottom: true};
const PREFIX = 'sombra-chat-scroll-v1';
export const chatScrollKey = (account: string, chat: string) =>
 account && chat ? `${PREFIX}:${JSON.stringify([account, chat])}` : '';
function load(key: string) {
 try {
  return localStorage.getItem(key);
 } catch {
  return null;
 }
}
function save(key: string, value: string) {
 try {
  localStorage.setItem(key, value);
 } catch {
  /* Storage can be disabled or full. */
 }
}
export function readAnchor(key: string): Anchor | null {
 try {
  const value = JSON.parse(load(key) || 'null');
  return value?.bottom === true
   ? {bottom: true}
   : typeof value?.id === 'string' && Number.isFinite(value.offset)
     ? {id: value.id, offset: value.offset}
     : null;
 } catch {
  return null;
 }
}
const row = (root: HTMLElement, id: string) =>
 id ? root.querySelector<HTMLElement>(`:scope > [data-message-id="${CSS.escape(id)}"]`) : null;
const top = (root: HTMLElement) => root.getBoundingClientRect().top + root.clientTop;
const atBottom = (root: HTMLElement) => root.scrollHeight - root.scrollTop - root.clientHeight <= 8;
function snapshot(root: HTMLElement): Anchor | null {
 if (atBottom(root)) return {bottom: true};
 // Transcript message rows are contiguous direct children, followed by activity and the end marker.
 let lo = 0,
  hi = root.children.length;
 const viewTop = top(root);
 while (lo < hi) {
  const mid = (lo + hi) >>> 1,
   child = root.children[mid] as HTMLElement;
  if (!child.dataset.messageId || child.getBoundingClientRect().bottom > viewTop) hi = mid;
  else lo = mid + 1;
 }
 const first = root.children[lo] as HTMLElement | undefined;
 return first?.dataset.messageId
  ? {id: first.dataset.messageId, offset: first.getBoundingClientRect().top - viewTop}
  : null;
}

export function useChatScroll(
 ref: RefObject<HTMLDivElement | null>,
 key: string,
 revision: string,
 jump: string,
 jumpEpoch: number,
 readIds: readonly string[]
) {
 const [mode, setMode] = useState<'read' | 'bottom' | null>(null);
 const sticky = useRef(true),
  second = useRef(false),
  lastRead = useRef('');
 const sync = useRef<() => void>(() => {});
 const destination = useRef('');
 const acceptRead = useCallback(
  (ids: string[]) => {
   if (!key) return;
   const stored = load(`${key}:read`) || '';
   const candidates = new Set(ids);
   let latest = '';
   for (let i = readIds.length - 1; i >= 0; i--)
    if (candidates.has(readIds[i]) || readIds[i] === stored) {
     latest = readIds[i];
     break;
    }
   if (!latest || latest === stored) return;
   save(`${key}:read`, latest);
   lastRead.current = latest;
   sync.current();
  },
  [key, readIds]
 );
 useLayoutEffect(() => {
  const root = ref.current;
  if (!root || !key) {
   setMode(null);
   return;
  }
  let previous = load(key);
  lastRead.current = load(`${key}:read`) || '';
  second.current = false;
  const update = () => {
   if (atBottom(root)) {
    second.current = false;
    setMode(null);
    return;
   }
   const target = row(root, lastRead.current);
   const below = target && target.getBoundingClientRect().top >= top(root) + root.clientHeight - 8;
   setMode(!second.current && below ? 'read' : 'bottom');
  };
  sync.current = update;
  destination.current = key;
  const persist = () => {
   sticky.current = atBottom(root);
   update();
   const anchor = snapshot(root);
   if (!anchor) return;
   const encoded = JSON.stringify(anchor);
   if (previous !== encoded) {
    save(key, encoded);
    previous = encoded;
   }
  };
  if (jump && row(root, jump)) sticky.current = false;
  else {
   const stored = readAnchor(key);
   const anchor = stored && 'id' in stored ? row(root, stored.id) : null;
   if (anchor && stored && 'offset' in stored)
    root.scrollTop += anchor.getBoundingClientRect().top - top(root) - stored.offset;
   else root.scrollTop = root.scrollHeight;
   sticky.current = atBottom(root);
  }
  update();
  root.addEventListener('scroll', persist, {passive: true});
  window.addEventListener('pagehide', persist);
  return () => {
   root.removeEventListener('scroll', persist);
   window.removeEventListener('pagehide', persist);
   sync.current = () => {};
   destination.current = '';
  };
 }, [ref, key]);
 useLayoutEffect(() => {
  const root = ref.current;
  if (!root || !key) return;
  if (jump && row(root, jump)) sticky.current = false;
  else if (sticky.current) root.scrollTop = root.scrollHeight;
  sync.current();
 }, [ref, key, revision, jump, jumpEpoch]);
 function goDown() {
  const root = ref.current;
  if (!root || destination.current !== key) return;
  const target = mode === 'read' ? row(root, lastRead.current) : null;
  if (target) {
   second.current = true;
   sticky.current = false;
   root.scrollTop += target.getBoundingClientRect().top - top(root) - root.clientHeight * 0.25;
  } else {
   sticky.current = true;
   root.scrollTop = root.scrollHeight;
   root.focus({preventScroll: true});
  }
  sync.current();
 }
 function followOnNextUpdate() {
  if (key && destination.current === key) sticky.current = true;
 }
 return {mode, goDown, sticky, acceptRead, followOnNextUpdate};
}
