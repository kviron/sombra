// Чистые правила активности бота: разбор записи, истечение окна и подписи строк.
// Файл импортирует только типы: так его читает node --experimental-strip-types.
import type {ChatState, User} from '@/shared/types';

/**
 * Live bot activity comes from the server's `state.botTyping[]`:
 *
 *   {bot, channel, until, started_at, activity, status}
 *
 * `started_at` is Unix **seconds**, `activity` is a **code** from the enum below and
 * `status` is a ready short label. The transport still opens an eight-second window per
 * update and carries no stage weights, no prompt and no verified percentage.
 *
 * An older worker may still send the pre-enum `stage` / `startedAt` pair, so every field
 * is read through the safe parser instead of widening the public `ChatState` DTO. That
 * keeps an older or newer server from breaking compilation or rendering, and it keeps
 * this module inside its own zone (the shared API types are owned elsewhere).
 */
export type BotTypingEntry = {bot: string; channel: string; until: number};

/** Activity codes → the short Russian labels the chat shows (status overrides them). */
const ACTIVITY_LABELS: Record<string, string> = {
 thinking: 'Думает',
 tool: 'Выполняет инструмент',
 image: 'Генерирует изображение',
 search: 'Ищет',
 code: 'Пишет код',
 waiting: 'Ожидает ответа сервиса'
};
export const NEUTRAL_STAGE = 'работает…';
export const IMAGE_ACTIVITY_FALLBACK = 'Генерирую изображение…';
const IMAGE_MIMES = new Set(['image/gif', 'image/png', 'image/jpeg', 'image/webp']);

/** One short stage line; anything longer is kept for the expandable detail. */
function readText(value: unknown, limit: number): string {
 if (typeof value !== 'string') return '';
 const text = value.replace(/\s+/g, ' ').trim();
 if (!text) return '';
 return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

/** Only the documented enum codes are translated; free text stays free text (legacy). */
function readCode(value: unknown): string {
 if (typeof value !== 'string') return '';
 const code = value.trim().toLowerCase();
 return Object.prototype.hasOwnProperty.call(ACTIVITY_LABELS, code) ? code : '';
}

/** Optional start moment in milliseconds; unix seconds and ISO strings are accepted. */
function readTimestamp(value: unknown): number | undefined {
 let ms = Number.NaN;
 if (typeof value === 'number') ms = value;
 else if (typeof value === 'string' && value.trim()) {
  const numeric = Number(value);
  ms = Number.isFinite(numeric) ? numeric : Date.parse(value);
 }
 if (!Number.isFinite(ms) || ms <= 0) return undefined;
 if (ms < 1e11) ms *= 1000;
 return Math.min(ms, Date.now());
}

export type BotActivity = {
 /** Enum code when the worker reports one; '' for legacy free text. */
 code: string;
 /** Ready label from the worker; takes priority over every derived label. */
 status: string;
 /** Line shown on the compact row: status → mapped code → legacy stage → free text. */
 stage: string;
 /** Long text behind the expand control; never the enum code itself. */
 detail: string;
 /** Epoch milliseconds from `started_at` (or the legacy `startedAt`). */
 startedAt: number | undefined;
};

export function readActivity(entry: BotTypingEntry): BotActivity {
 // Extra fields are read defensively: a future or older server can never crash a render.
 const fields = entry as unknown as Record<string, unknown>;
 const code = readCode(fields.activity);
 const status = readText(fields.status, 48);
 const legacyStage = readText(fields.stage, 48);
 // A free-text `activity` is the pre-enum worker's stage sentence, never a code.
 const legacyActivity = code ? '' : readText(fields.activity, 48);
 const stage = status || (code ? ACTIVITY_LABELS[code] : '') || legacyStage || legacyActivity;
 const freeText = code ? '' : readText(fields.activity, 240);
 const detail =
  readText(fields.detail, 240) || readText(fields.description, 240) || (freeText && freeText !== stage ? freeText : '');
 return {code, status, stage, detail, startedAt: readTimestamp(fields.started_at) ?? readTimestamp(fields.startedAt)};
}

/** Live entries for one channel: an expired window is never rendered. */
export function activeEntries(state: Pick<ChatState, 'botTyping'>, channel: string, now: number): BotTypingEntry[] {
 return (state.botTyping || []).filter(
  item => item.channel === channel && Number.isFinite(item.until) && item.until > now
 );
}

/**
 * A picture this bot already delivered inside the current generation window hides the
 * card at once, without waiting for the next poll. `started_at` and message times are
 * both server seconds, so this needs no clock agreement with the device; without it the
 * card simply lives until the entry itself is cleared.
 */
export function imageDelivered(state: Pick<ChatState, 'messages'>, entry: BotTypingEntry): boolean {
 const startMs = readActivity(entry).startedAt;
 if (startMs === undefined) return false;
 return (state.messages || []).some(
  message =>
   message.channel === entry.channel &&
   message.user === entry.bot &&
   !!message.attachment &&
   IMAGE_MIMES.has(message.attachment.mime) &&
   message.time * 1000 >= startMs
 );
}

/** Запись относится к генерации изображения: у неё своя карточка вместо строки «печатает». */
export const isImageActivity = (entry: BotTypingEntry) => readActivity(entry).code === 'image';

/**
 * True while the transcript really shows the live image-generation card for this channel.
 * The chat shell uses it to keep a single activity signal: the card replaces the composer
 * status row and its typing dots while it is on screen.
 */
export function hasLiveImageActivity(
 state: Pick<ChatState, 'botTyping' | 'messages'>,
 channel: string,
 now = Date.now() / 1000
): boolean {
 const entry = activeEntries(state, channel, now).find(isImageActivity);
 return !!entry && !imageDelivered(state, entry);
}

/** Stable identity of every live window; a replaced entry restarts the expiry clock. */
export function typingKeys(state: Pick<ChatState, 'botTyping'>): string {
 return (state.botTyping || []).map(item => `${item.bot}@${item.until}`).join('|');
}

/** Nearest expiry in this channel, so one timer covers the row and the image card. */
export function earliestUntil(state: Pick<ChatState, 'botTyping'>, channel: string): number | undefined {
 return (state.botTyping || [])
  .filter(item => item.channel === channel)
  .reduce<number | undefined>(
   (earliest, item) => (earliest === undefined || item.until < earliest ? item.until : earliest),
   undefined
  );
}

/** Сколько ждать до истечения окна: undefined, если оно уже прошло или время некорректно. */
export function expiryDelay(untilSeconds: number, nowMs: number): number | undefined {
 const untilMs = untilSeconds * 1000;
 if (!Number.isFinite(untilMs) || untilMs <= nowMs) return undefined;
 // Небольшой запас, чтобы таймер сработал уже после границы окна.
 return Math.max(60, untilMs - nowMs + 25);
}

/** Кто из ботов активен в канале сейчас: по ним строится строка «боты печатают». */
export function botIdentity(state: ChatState, id: string): {name: string; user?: User} {
 const user = state.users.find(item => item.id === id);
 const bot = state.bots?.find(item => item.id === id);
 return {name: user?.name || bot?.name || 'Сомбра', user: user && (user.bot || !!bot) ? user : undefined};
}

export function typingBotNames(
 state: Pick<ChatState, 'botTyping' | 'users'>,
 channel: string,
 now = Date.now() / 1000
): string[] {
 const ids = new Set(activeEntries(state, channel, now).map(item => item.bot));
 return state.users.filter(user => user.bot && ids.has(user.id)).map(user => user.name);
}

/** Строка этапа: готовый `status` важнее кода, а без них — нейтральное «работает…». */
export const typingStage = (activity: BotActivity) => activity.stage || NEUTRAL_STAGE;

/** Объявление для скринридера: этап дополняет фразу, а не заменяет её. */
export const typingAnnouncement = (name: string, stage: string) =>
 stage ? `${name} печатает: ${stage}` : `${name} печатает…`;

/** Подпись карточки генерации: только готовый статус работника или нейтральная фраза. */
export const imageActivityLabel = (activity: BotActivity) => activity.status || IMAGE_ACTIVITY_FALLBACK;

type ScrollMetrics = {scrollHeight: number; scrollTop: number; clientHeight: number};

/**
 * Карточка уже вставлена, поэтому «был внизу» — это остаток пути в пределах её высоты.
 * Дальше наверх сидит человек, читающий историю: его не тянем вниз.
 */
export function followsActivity(metrics: ScrollMetrics, height: number) {
 return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight <= height + 24;
}
