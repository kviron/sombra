import {useEffect, useRef, useState} from 'react';
import {errorDetails, errorSummary, errorTitle} from '../lib/error-summary';

type Props = {
 error: Error;
 componentStack: string | null;
 onRetry: () => void;
 onReload: () => void;
};

const BUTTON = 'inline-flex items-center rounded-[10px] border px-4 text-sm';
const PRIMARY = 'border-transparent bg-[#5d0ec0] font-medium text-[#f5f3ff] hover:brightness-110';
const SECONDARY = 'border-border bg-foreground/[0.06] text-foreground hover:bg-foreground/[0.11]';
const QUIET = 'border-transparent bg-transparent text-muted-foreground hover:text-foreground';

/** Экран сбоя без зависимостей от UI-кита: если сломался общий слой, он всё равно отрисуется. */
export function ErrorScreen({error, componentStack, onRetry, onReload}: Props) {
 const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle');
 const primary = useRef<HTMLButtonElement | null>(null);

 // Упавший элемент размонтирован вместе с фокусом: возвращаем его на главное действие.
 useEffect(() => {
  primary.current?.focus();
 }, []);

 async function copy() {
  try {
   await navigator.clipboard.writeText(errorDetails(error, componentStack));
   setCopied('done');
  } catch {
   setCopied('failed');
  }
  window.setTimeout(() => setCopied('idle'), 2500);
 }

 return (
  <main className="fixed inset-0 z-[9000] grid place-items-center overflow-auto bg-background p-6 text-foreground" role="alert" aria-live="assertive">
   <section className="grid w-full max-w-[640px] gap-4 rounded-[14px] border border-border bg-card p-8 shadow-[0_24px_64px_rgb(0_0_0/0.35)]">
    <p className="m-0 font-mono text-[11px] tracking-[0.16em] uppercase text-muted-foreground">Сбой экрана</p>
    <h1 className="m-0 text-[22px] leading-tight font-semibold tracking-[-0.01em]">{errorTitle(error)}</h1>
    <p className="m-0 text-sm leading-relaxed text-muted-foreground">
     Переписка, звонки и настройки не пострадали: данные остались на сервере и в локальном хранилище. Продолжить можно с этого же места.
    </p>
    <pre className="m-0 max-h-[180px] overflow-auto rounded-[10px] border border-border bg-foreground/[0.04] p-3 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
     {errorSummary(error)}
    </pre>
    <div className="flex flex-wrap gap-2">
     <button type="button" ref={primary} className={`${BUTTON} ${PRIMARY} min-h-[38px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring`} onClick={onRetry}>Вернуться в приложение</button>
     <button type="button" className={`${BUTTON} ${SECONDARY} min-h-[38px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring`} onClick={onReload}>Перезагрузить</button>
     <button type="button" className={`${BUTTON} ${QUIET} min-h-[38px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring`} onClick={() => void copy()}>
      {copied === 'done' ? 'Скопировано' : copied === 'failed' ? 'Не удалось скопировать' : 'Скопировать текст ошибки'}
     </button>
    </div>
    <details className="border-t border-border pt-3">
     <summary className="cursor-pointer text-[13px] text-muted-foreground">Подробности для отчёта об ошибке</summary>
     <pre className="mt-2 max-h-[220px] overflow-auto font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">
      {errorDetails(error, componentStack)}
     </pre>
    </details>
   </section>
  </main>
 );
}
