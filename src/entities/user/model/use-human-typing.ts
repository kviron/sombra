import {useEffect, useRef} from 'react';
import type {ChatState} from '@/shared/types';
import {userService} from './services/user-service';
type Context = {
 account: string;
 channel: string;
 epoch: number;
 live: boolean;
 wanted: boolean;
 lastInput: number;
 lastPulse: number;
 timer?: ReturnType<typeof setTimeout>;
};
/** Only a boolean activity signal leaves this hook; restored drafts never trigger it. */
export function useHumanTyping(state: ChatState | null, channel: string, enabled: boolean) {
 const current = useRef(state);
 current.current = state;
 const epoch = useRef(0),
  context = useRef<Context | null>(null),
  chain = useRef(Promise.resolve());
 function queue(ctx: Context, active: boolean) {
  chain.current = chain.current.then(async () => {
   if (ctx.epoch !== epoch.current || current.current?.me.id !== ctx.account) return;
   if (active && (!ctx.live || !ctx.wanted || Date.now() - ctx.lastInput > 3500)) return;
   try {
    await userService.setTyping({channel: ctx.channel, active});
   } catch {
    /* Ephemeral: server TTL is the final cleanup. */
   }
  });
 }
 function stop() {
  const ctx = context.current;
  if (!ctx) return;
  if (ctx.timer) clearTimeout(ctx.timer);
  ctx.wanted = false;
  ctx.lastPulse = 0;
  queue(ctx, false);
 }
 useEffect(() => {
  const changed = () => {
   epoch.current++;
   const ctx = context.current;
   if (ctx) {
    ctx.live = false;
    ctx.wanted = false;
    if (ctx.timer) clearTimeout(ctx.timer);
   }
  };
  window.addEventListener('authchange', changed);
  return () => window.removeEventListener('authchange', changed);
 }, []);
 useEffect(() => {
  if (!enabled || !state || !channel) {
   context.current = null;
   return;
  }
  const ctx: Context = {
   account: state.me.id,
   channel,
   epoch: epoch.current,
   live: true,
   wanted: false,
   lastInput: 0,
   lastPulse: 0
  };
  context.current = ctx;
  const pause = () => {
   if (context.current === ctx) stop();
  };
  const hidden = () => {
   if (document.visibilityState !== 'visible') pause();
  };
  window.addEventListener('blur', pause);
  document.addEventListener('visibilitychange', hidden);
  return () => {
   ctx.live = false;
   ctx.wanted = false;
   if (ctx.timer) clearTimeout(ctx.timer);
   queue(ctx, false);
   if (context.current === ctx) context.current = null;
   window.removeEventListener('blur', pause);
   document.removeEventListener('visibilitychange', hidden);
  };
 }, [state?.me.id, channel, enabled]);
 return {
  stop,
  input: (nonempty: boolean) => {
   const ctx = context.current;
   if (!ctx?.live) return;
   if (!nonempty || document.visibilityState !== 'visible') {
    stop();
    return;
   }
   ctx.wanted = true;
   ctx.lastInput = Date.now();
   if (!ctx.lastPulse || ctx.lastInput - ctx.lastPulse >= 2000) {
    ctx.lastPulse = ctx.lastInput;
    queue(ctx, true);
   }
   if (ctx.timer) clearTimeout(ctx.timer);
   ctx.timer = setTimeout(stop, 3500);
  }
 };
}
