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
   <div className="journal-heading bg-background flex flex-wrap items-start justify-between gap-3">
    <div>
     <h2>Журнал</h2>
     <p>Диагностика Sombra за последние 48 часов</p>
    </div>
    <div className="journal-actions flex flex-wrap items-center gap-2">
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
   <div
    className="journal-summary bg-secondary text-secondary-foreground mt-5 flex items-center gap-3 rounded-[var(--radius-lg)] px-4 py-3"
    role="status"
   >
    <strong className="journal-total text-destructive text-2xl leading-[1.25] tabular-nums">
     {entries?.length ?? '—'}
    </strong>
    <div>
     <strong>Ошибки</strong>
     <p>В сохранённых записях</p>
    </div>
   </div>
   <h3 className="mt-4 mb-3 text-base leading-[1.5] font-semibold">Хронология ошибок</h3>
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
    <ol className="journal-entries m-0 list-none p-0">
     {entries.map(({time, operation, category, status}, index) => {
      const date = new Date(time * 1000);
      const valid = Number.isFinite(date.getTime());
      const details = model.details({operation, category, status});
      return (
       <li
        key={`${time}-${operation}-${index}`}
        className="grid grid-cols-[72px_minmax(0,1fr)] items-start gap-4 [overflow-wrap:anywhere]"
       >
        {valid ? (
         <time
          className="text-muted-foreground pt-3.5 tabular-nums"
          dateTime={date.toISOString()}
          title={model.fullDate(date)}
          aria-label={model.fullDate(date)}
         >
          {model.clock(date)}
         </time>
        ) : (
         <span className="text-muted-foreground pt-3.5 tabular-nums">—</span>
        )}
        <details className="border-border relative min-w-0 border-s pb-3 pl-4" open={index === 0 || undefined}>
         <summary className="journal-entry-heading bg-secondary hover:bg-accent relative min-h-11 cursor-pointer list-none rounded-[var(--radius-lg)] px-9 pt-3 pb-3 pl-3 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--ring)]">
          {status !== null && <Badge variant="secondary">HTTP {status}</Badge>}
          <strong>{model.label(operation, category)}</strong>
          <code>{operation}</code>
          <ChevronDown size={16} aria-hidden="true" />
         </summary>
         <div className="journal-entry-details border-border bg-secondary overflow-hidden rounded-b-[var(--radius-lg)] border-t">
          <div className="journal-code-head border-border flex flex-wrap items-center justify-between gap-2 border-b px-3 py-1">
           <strong>Детали ошибки</strong>
           <span className="text-muted-foreground inline-flex items-center gap-1 text-xs leading-[1.5]">
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
          <pre className="m-0 overflow-auto px-3.5 py-3 text-xs leading-[1.5] whitespace-pre">
           <code>
            {'{\n'}
            {Object.entries(details).map(([key, value], i) => (
             <span key={key}>
              {'  '}
              <b className="text-ring font-medium">{JSON.stringify(key)}</b>
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
   <footer className="mt-4">Звук, сообщения и токены не сохраняются.</footer>
  </section>
 );
}
