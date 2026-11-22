import {useEffect, useRef, useState} from 'react';
import {tauri} from '@/shared/api';
import {toast} from 'sonner';
import {stateService} from '@/shared/api';
import type {ChatState} from '@/shared/types';
import {
 notificationRoute,
 validNotificationTarget,
 type NotificationTarget,
 type NotificationRoute
} from './notification-target';

export function useNotificationActivation(
 state: ChatState | null,
 onOpen: (next: ChatState, route: NotificationRoute) => void
) {
 const current = useRef({state, onOpen});
 current.current = {state, onOpen};
 const [pending, setPending] = useState<NotificationTarget | null>(null);
 const authVersion = useRef(0);
 useEffect(() => {
  const changed = () => {
   authVersion.current++;
   setPending(null);
  };
  window.addEventListener('authchange', changed);
  return () => window.removeEventListener('authchange', changed);
 }, []);
 useEffect(() => {
  if (!tauri.isTauri()) return;
  let alive = true,
   unlisten: (() => void) | undefined;
  // Serialize drains: simultaneous ready/event IPC replies must not discard a consumed target.
  let chain = Promise.resolve();
  const drain = () => {
   chain = chain
    .then(async () => {
     if (!alive) return;
     const value = await tauri.commands.notifications.takeTarget<unknown>();
     if (alive && validNotificationTarget(value)) setPending(value);
    })
    .catch(() => {});
  };
  void tauri.events
   .listen('notification-activate', drain)
   .then(stop => {
    if (!alive) {
     stop();
     return;
    }
    unlisten = stop;
    drain();
   })
   .catch(() => {});
  return () => {
   alive = false;
   unlisten?.();
  };
 }, []);
 useEffect(() => {
  if (!pending || !state) return;
  if (pending.account !== state.me.id) {
   setPending(null);
   return;
  }
  let cancelled = false;
  const version = authVersion.current;
  void (async () => {
   try {
    const next = await stateService.load<ChatState>({sticker_assets: true});
    if (cancelled || version !== authVersion.current || current.current.state?.me.id !== pending.account) return;
    const route = notificationRoute(next, pending);
    if (route) current.current.onOpen(next, route);
    else toast.error('Этот чат больше недоступен.');
   } catch {
    if (!cancelled && version === authVersion.current) toast.error('Не удалось открыть чат. Проверьте соединение.');
   } finally {
    if (!cancelled) setPending(value => (value === pending ? null : value));
   }
  })();
  return () => {
   cancelled = true;
  };
 }, [pending, state?.me.id]);
 return (target: NotificationTarget) => {
  if (validNotificationTarget(target)) setPending({...target});
 };
}
