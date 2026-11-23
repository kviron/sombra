import {ChevronDown, Copy, Download, RefreshCw, Trash2} from 'lucide-react';
import {Badge} from '@/shared/ui/badge';
import {Button} from '@/shared/ui/button';
import {useDiagnosticJournal} from '../model/use-diagnostic-journal';
import type {DiagnosticEntry} from '../model/diagnostic-journal-rules';
import './diagnostic-journal.css';

export type {DiagnosticEntry} from '../model/diagnostic-journal-rules';

export function DiagnosticJournal({
 read,
 clear,
 available
}: {
 read?: () => Promise<DiagnosticEntry[]>;
 clear?: () => Promise<void>;
 available?: boolean;
}) {
 const model = useDiagnosticJournal({read, clear, available});
 const {phase, entries, feedback, loading} = model;
 return (
  <section className="diagnostic-journal" aria-label="Журнал диагностики">
   <div className="journal-heading surface-matte">
    <div>
     <h2>Журнал</h2>
     <p>Диагностика Sombra за последние 48 часов</p>
    </div>
    <div className="journal-actions">
     <Button type="button" disabled={!model.available || loading} onClick={model.refresh}>
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
      onClick={model.download}
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
      onClick={model.copy}
     >
      <Copy />
     </Button>
     <Button
      type="button"
      variant="ghost"
      size="icon"
      title="Очистить журнал"
      aria-label="Очистить журнал"
      disabled={!model.available || !entries?.length}
      onClick={model.clearJournal}
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
   {!model.available ? (
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
      const details = model.details({operation, category, status});
      return (
       <li key={`${time}-${operation}-${index}`}>
        {valid ? (
         <time dateTime={date.toISOString()} title={model.fullDate(date)} aria-label={model.fullDate(date)}>
          {model.clock(date)}
         </time>
        ) : (
         <span>—</span>
        )}
        <details open={index === 0 || undefined}>
         <summary className="journal-entry-heading">
          {status !== null && <Badge variant="secondary">HTTP {status}</Badge>}
          <strong>{model.label(operation, category)}</strong>
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
             onClick={() => model.copyDetails(details)}
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
