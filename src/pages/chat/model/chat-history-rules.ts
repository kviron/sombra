// Чистые правила истории канала: без сети, DOM и React, поэтому проверяются тестами.
// Файл импортирует только типы: так его читает node --experimental-strip-types.
import type {ChatMessage} from '@/shared/types';

/** Лимит страницы истории: как у сервера — по умолчанию 50, допустимо 1–100. */
export const HISTORY_PAGE_LIMIT = 50;
export const HISTORY_PAGE_LIMIT_MIN = 1;
export const HISTORY_PAGE_LIMIT_MAX = 100;

/** Код ошибки сервера: курсор указывает на удалённое или недоступное сообщение. */
export const HISTORY_CURSOR_INVALID = 'HISTORY_CURSOR_INVALID';

/** Лимит запроса: целое число в диапазоне сервера, без значения — 50. */
export function historyLimit(value?: number) {
 if (value === undefined || !Number.isFinite(value)) return HISTORY_PAGE_LIMIT;
 return Math.min(HISTORY_PAGE_LIMIT_MAX, Math.max(HISTORY_PAGE_LIMIT_MIN, Math.trunc(value)));
}

/** Дубли по id отбрасываются: в списке остаётся первое появление сообщения. */
function uniqueMessages(messages: readonly ChatMessage[]) {
 const seen = new Set<string>();
 const unique: ChatMessage[] = [];
 for (const message of messages) {
  if (!message?.id || seen.has(message.id)) continue;
  seen.add(message.id);
  unique.push(message);
 }
 return unique;
}

/** Страница сервера (старые → новые) встаёт перед уже загруженными сообщениями, без дублей. */
export function prependHistoryPage(loaded: readonly ChatMessage[], page: readonly ChatMessage[]) {
 return uniqueMessages([...page, ...loaded]);
}

/**
 * История встаёт перед серверными сообщениями, поэтому разделители дней и порядок не меняются.
 * При совпадении id остаётся свежая серверная копия (текст могли отредактировать),
 * а место в списке — первое, из истории. Исходящие добавляются в конец, если их id ещё нет.
 */
export function mergeHistoryMessages(
 history: readonly ChatMessage[],
 server: readonly ChatMessage[],
 outgoing: readonly ChatMessage[] = []
) {
 const byId = new Map<string, ChatMessage>();
 for (const message of history) if (message?.id && !byId.has(message.id)) byId.set(message.id, message);
 for (const message of server) if (message?.id) byId.set(message.id, message);
 // Временные исходящие идут последними и никогда не заменяют подтверждённое сообщение.
 for (const message of outgoing) if (message?.id && !byId.has(message.id)) byId.set(message.id, message);
 return [...byId.values()];
}

/** Ошибка «курсор устарел»: сервер прислал код HISTORY_CURSOR_INVALID, а не текст. */
export function isHistoryCursorInvalid(error: unknown) {
 const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
 return message.includes(HISTORY_CURSOR_INVALID);
}

/** Канал, у которого сервер отметил обрезанную историю: его страницу можно догрузить сразу. */
export function historyTruncated(state: {historyTruncated?: string[]} | null | undefined, channel: string) {
 return !!channel && state?.historyTruncated?.includes(channel) === true;
}

export type HistoryStatus = {hasMore: boolean; loading: boolean; error: string};

/** Кнопка «Показать более ранние»: есть что грузить, загрузка не идёт и ошибки нет. */
export const historyButtonVisible = ({hasMore, loading, error}: HistoryStatus) => hasMore && !loading && !error;

/** Строка «Загрузка…» вместо кнопки. */
export const historyLoadingVisible = ({loading}: HistoryStatus) => loading;

/** «Повторить» — только у упавшей загрузки, когда новый запрос уже не идёт. */
export const historyRetryVisible = ({loading, error}: HistoryStatus) => !loading && !!error;

/** Текст ошибки: понятная фраза и, если сервер объяснил причину, сама причина. */
export const historyErrorText = (error: string) =>
 error ? `Не удалось загрузить более ранние сообщения. ${error}` : '';

type LoadGuard = {loading: boolean; loaded: boolean; hasMore: boolean};

/**
 * Догрузка разрешена, если не идёт загрузка и либо страница ещё ни разу не грузилась,
 * либо сервер обещал продолжение (`hasMore`). Так повтор после ошибки остаётся возможен.
 */
export const canLoadOlder = ({loading, loaded, hasMore}: LoadGuard) => !loading && (!loaded || hasMore);
