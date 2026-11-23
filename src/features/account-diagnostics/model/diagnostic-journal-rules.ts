// Чистые правила журнала диагностики: подписи категорий, экспорт и порядок записей.
export type DiagnosticEntry = {
 time: number;
 source: 'desktop';
 operation: string;
 category: string;
 status: number | null;
};

export type JournalPhase = 'loading' | 'ready' | 'failed';
export type JournalState = {phase: JournalPhase; entries: DiagnosticEntry[] | null};

const CATEGORIES: Record<string, string> = {
 transport: 'Ошибка соединения',
 timeout: 'Время ожидания истекло',
 invalid_response: 'Некорректный ответ',
 session_storage: 'Ошибка хранения сеанса',
 http_error: 'Ошибка HTTP',
 js_error: 'Ошибка интерфейса',
 unhandled_rejection: 'Ошибка интерфейса',
 render_error: 'Экран остановился из-за ошибки',
 device_error: 'Ошибка устройства',
 device_permission: 'Нет доступа к устройству',
 mic_silent: 'Микрофон молчит',
 mic_silent_recovered: 'Звук с микрофона пошёл',
 autoplay_blocked: 'Автовоспроизведение заблокировано',
 playback_error: 'Ошибка воспроизведения'
};

const TITLES: Record<string, string> = {
 voice_poll: 'Не удалось обновить состояние голосовой комнаты',
 state: 'Не удалось загрузить состояние приложения'
};

const clock = new Intl.DateTimeFormat('ru', {hour: '2-digit', minute: '2-digit', second: '2-digit'});
const fullDate = new Intl.DateTimeFormat('ru', {dateStyle: 'medium', timeStyle: 'medium'});

export function categoryLabel(category: string): string {
 return CATEGORIES[category] ?? 'Ошибка приложения';
}

/** Операция важнее категории: так запись узнаётся без открытия деталей. */
export function entryLabel(operation: string, category: string): string {
 return TITLES[operation] ?? categoryLabel(category);
}

/** Тело записи без времени: его копируют из открытых деталей. */
export function entryDetails({
 operation,
 category,
 status
}: Pick<DiagnosticEntry, 'operation' | 'category' | 'status'>) {
 return {source: 'desktop' as const, operation, category, status};
}

/** Экспорт в NDJSON: каждая запись отдельной строкой, в конце — перевод строки. */
export function journalExportText(entries: DiagnosticEntry[]): string {
 return (
  entries
   .map(({time, source, operation, category, status}) => JSON.stringify({time, source, operation, category, status}))
   .join('\n') + '\n'
 );
}

/** Свежие записи сверху: журнал читается как хронология от нового к старому. */
export function newestFirst(entries: DiagnosticEntry[]): DiagnosticEntry[] {
 return [...entries].reverse();
}

export function journalClock(date: Date): string {
 return clock.format(date);
}

export function journalFullDate(date: Date): string {
 return fullDate.format(date);
}
