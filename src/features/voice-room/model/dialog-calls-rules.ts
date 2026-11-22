// Чистые правила звонков в переписке: срок жизни звонка, выбор входящего и ошибки.
import type {DialogCall} from '@/shared/types';

/** Пустой звонок живёт минуту: после этого он считается завершённым без ответа. */
export const CALL_EMPTY_GRACE_MS = 60000;

export function liveCall(call: DialogCall, now: number = Date.now()): boolean {
 return !call.empty_since || call.empty_since * 1000 + CALL_EMPTY_GRACE_MS > now;
}

type IncomingArgs = {
 calls: DialogCall[];
 account: string;
 room: string;
 handled: ReadonlySet<string>;
 now?: number;
};

/** Входящий — живой звонок не от себя, не в текущей комнате и ещё не обработанный. */
export function incomingCall({calls, account, room, handled, now = Date.now()}: IncomingArgs): DialogCall | undefined {
 return calls.find(
  call =>
   liveCall(call, now) &&
   call.caller !== account &&
   !call.participants.includes(account) &&
   !call.declined.includes(account) &&
   room !== call.id &&
   !handled.has(call.id)
 );
}

export function callsBusy(operation: {id: string} | null, declining: {id: string} | null): boolean {
 return !!operation || !!declining;
}

/** Занят ли именно этот звонок: чужая операция не блокирует кнопки входящего. */
export function incomingCallsBusy({
 operation,
 declining,
 id
}: {
 operation: {id: string} | null;
 declining: {id: string} | null;
 id: string | undefined;
}): boolean {
 return !!((operation && operation.id === id) || (declining && declining.id === id));
}

/** Текст ошибки действия: сообщение сервера важнее подписи места. */
export function callError(reason: unknown, fallback: string): string {
 return reason instanceof Error && reason.message ? reason.message : fallback;
}
