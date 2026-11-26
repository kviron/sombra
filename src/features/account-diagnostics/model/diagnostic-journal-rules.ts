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
 ui_freeze: 'Зависание интерфейса',
 session_storage: 'Ошибка хранения сеанса',
 http_error: 'Ошибка HTTP',
 js_error: 'Ошибка интерфейса',
 unhandled_rejection: 'Ошибка интерфейса',
 render_error: 'Экран остановился из-за ошибки',
 device_error: 'Ошибка устройства',
 device_permission: 'Нет доступа к устройству',
 ice_checking: 'Проверка голосового соединения',
 ice_connected: 'Голосовое соединение установлено',
 ice_disconnected: 'Голосовое соединение прервано',
 ice_failed: 'Не удалось установить голосовое соединение',
 path_direct: 'Прямое голосовое соединение',
 path_relay: 'Звук через ретранслятор',
 audio_receive_stalled: 'Входящие аудиопакеты перестали поступать',
 audio_receive_recovered: 'Приём аудиопакетов возобновился',
 audio_send_stalled: 'Отправка аудиопакетов остановилась',
 audio_send_recovered: 'Отправка аудиопакетов возобновилась',
 audio_receive_silent: 'Тишина во входящем звуке',
 audio_receive_silent_recovered: 'Во входящем потоке снова есть звук',
 audio_send_silent: 'Тишина в исходящем звуке',
 audio_send_silent_recovered: 'В исходящем потоке снова есть звук',
 mic_muted: 'Микрофон выключен',
 mic_unmuted: 'Микрофон включён',
 output_deafened: 'Звук звонка выключен',
 output_undeafened: 'Звук звонка включён',
 playback_failed: 'Не удалось обработать звук для воспроизведения',
 output_device_failed: 'Устройство вывода недоступно',
 input_device_failed: 'Устройство ввода недоступно',
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
 return CATEGORIES[category] ?? 'Диагностическое событие';
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
