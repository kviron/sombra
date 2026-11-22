import {useEffect, useState} from 'react';
import {ChevronDown, Copy, Download, RefreshCw, Trash2} from 'lucide-react';
import {tauri} from '@/shared/api';
import {Badge} from '@/shared/ui/badge';
import {Button} from '@/shared/ui/button';
import './diagnostic-journal.css';

export type DiagnosticEntry = {
 time: number;
 source: 'desktop';
 operation: string;
 category: string;
 status: number | null;
};
const categories: Record<string, string> = {
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
const titles: Record<string, string> = {
 voice_poll: 'Не удалось обновить состояние голосовой комнаты',
 state: 'Не удалось загрузить состояние приложения'
};
const clock = new Intl.DateTimeFormat('ru', {hour: '2-digit', minute: '2-digit', second: '2-digit'});
const fullDate = new Intl.DateTimeFormat('ru', {dateStyle: 'medium', timeStyle: 'medium'});
const readEntries = () => tauri.commands.diagnostics.read<DiagnosticEntry>();
const clearEntries = () => tauri.commands.diagnostics.clear();

type JournalState = {phase: 'loading' | 'ready' | 'failed'; entries: DiagnosticEntry[] | null};
export function DiagnosticJournal({
 read = readEntries,
 clear = clearEntries,
 available = tauri.isTauri()
}: {
 read?: () => Promise<DiagnosticEntry[]>;
 clear?: () => Promise<void>;
 available?: boolean;
}) {
 const [request, setRequest] = useState(0);
 const [state, setState] = useState<JournalState>({phase: 'loading', entries: null});
 useEffect(() => {
  if (!available) return;
  let active = true;
  void Promise.resolve()
   .then(read)
   .then(
    entries => {
     if (active) setState({phase: 'ready', entries: [...entries].reverse()});
    },
    () => {
     if (active) setState(previous => ({...previous, phase: 'failed'}));
    }
   );
  return () => {
   active = false;
  };
 }, [available, read, request]);
 const [feedback, setFeedback] = useState('');
 const {phase, entries} = state;
 const exportText = () =>
  entries
   ?.map(({time, source, operation, category, status}) => JSON.stringify({time, source, operation, category, status}))
   .join('\n') + '\n';
 async function copy() {
  try {
   await navigator.clipboard.writeText(exportText());
   setFeedback('Журнал скопирован.');
  } catch {
   setFeedback('Не удалось скопировать журнал. Попробуйте скачать файл.');
  }
 }
 function download() {
  const url = URL.createObjectURL(new Blob([exportText()], {type: 'application/x-ndjson'}));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'sombra-diagnostics.jsonl';
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
 }
 async function clearJournal() {
  if (!available || !entries?.length) return;
  if (!window.confirm('Очистить журнал? Записи диагностики будут удалены без возможности восстановления.')) return;
  setState({phase: 'loading', entries: null});
  setFeedback('');
  try {
   await clear();
   setFeedback('Журнал очищен.');
   setRequest(previous => previous + 1);
  } catch {
   setState(previous => ({...previous, phase: 'failed'}));
   setFeedback('Не удалось очистить журнал. Попробуйте ещё раз.');
  }
 }
 const loading = available && phase === 'loading';
 const refresh = () => {
  setState(previous => ({...previous, phase: 'loading'}));
  setRequest(previous => previous + 1);
 };
 return (
  <section className="diagnostic-journal" aria-label="Журнал диагностики">
   <div className="journal-heading">
    <div>
     <h2>Журнал</h2>
     <p>Диагностика Sombra за последние 48 часов</p>
    </div>
    <div className="journal-actions">
     <Button type="button" disabled={!available || loading} onClick={refresh}>
      <RefreshCw />
      Обновить
     </Button>
     <Button
      type="button"
      variant="ghost"
      size="icon"
      title="Скачать журнал"
      aria-label="Скачать журнал"
      disabled={!entries?.length}
      onClick={download}
     >
      <Download />
     </Button>
     <Button
      type="button"
      variant="ghost"
      size="icon"
      title="Копировать журнал"
      aria-label="Копировать журнал"
      disabled={!entries?.length}
      onClick={() => void copy()}
     >
      <Copy />
     </Button>
     <Button
      type="button"
      variant="ghost"
      size="icon"
      title="Очистить журнал"
      aria-label="Очистить журнал"
      disabled={!available || !entries?.length}
      onClick={() => void clearJournal()}
     >
      <Trash2 />
     </Button>
    </div>
   </div>
   {feedback && <p role="status">{feedback}</p>}
   <div className="journal-summary" role="status">
    <strong className="journal-total">{entries?.length ?? '—'}</strong>
    <div>
     <strong>Ошибки</strong>
     <p>В сохранённых записях</p>
    </div>
   </div>
   <h3>Хронология ошибок</h3>
   {!available ? (
    <p role="status">Журнал доступен только в настольном приложении.</p>
   ) : loading ? (
    <p role="status">Загрузка журнала…</p>
   ) : phase === 'failed' ? (
    <p role="alert">
     Не удалось прочитать журнал. Нажмите «Обновить», чтобы повторить попытку.
     {entries ? ' Ниже показаны ранее загруженные данные.' : ''}
    </p>
   ) : entries?.length === 0 ? (
    <p role="status">За последние 48 часов ошибок не сохранено.</p>
   ) : null}
   {!!entries?.length && (
    <ol className="journal-entries">
     {entries.map(({time, operation, category, status}, index) => {
      const date = new Date(time * 1000);
      const valid = Number.isFinite(date.getTime());
      const label = categories[category] ?? 'Ошибка приложения';
      const details = {source: 'desktop', operation, category, status};
      return (
       <li key={`${time}-${operation}-${index}`}>
        {valid ? (
         <time dateTime={date.toISOString()} title={fullDate.format(date)} aria-label={fullDate.format(date)}>
          {clock.format(date)}
         </time>
        ) : (
         <span>—</span>
        )}
        <details open={index === 0 || undefined}>
         <summary className="journal-entry-heading">
          {status !== null && <Badge variant="secondary">HTTP {status}</Badge>}
          <strong>{titles[operation] ?? label}</strong>
          <code>{operation}</code>
          <ChevronDown size={16} aria-hidden="true" />
         </summary>
         <div className="journal-entry-details">
          <div className="journal-code-head">
           <strong>Детали ошибки</strong>
           <span>
            JSON{' '}
            <Button
             type="button"
             variant="ghost"
             size="icon"
             aria-label="Копировать JSON ошибки"
             onClick={async () => {
              try {
               await navigator.clipboard.writeText(JSON.stringify(details, null, 2));
               setFeedback('Детали ошибки скопированы.');
              } catch {
               setFeedback('Не удалось скопировать детали ошибки.');
              }
             }}
            >
             <Copy />
            </Button>
           </span>
          </div>
          <pre>
           <code>
            {'{\n'}
            {Object.entries(details).map(([key, value], i) => (
             <span key={key}>
              {'  '}
              <b>{JSON.stringify(key)}</b>
              {': '}
              {JSON.stringify(value)}
              {i < 3 ? ',' : ''}
              {'\n'}
             </span>
            ))}
            {'}'}
           </code>
          </pre>
         </div>
        </details>
       </li>
      );
     })}
    </ol>
   )}
   <footer>Звук, сообщения и токены не сохраняются.</footer>
  </section>
 );
}
