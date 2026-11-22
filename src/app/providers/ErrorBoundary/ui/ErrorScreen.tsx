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
  <main
   className="bg-background text-foreground fixed inset-0 z-[9000] grid place-items-center overflow-auto p-6"
   role="alert"
   aria-live="assertive"
  >
   <section className="border-border bg-card grid w-full max-w-[640px] gap-4 rounded-[14px] border p-8 shadow-[0_24px_64px_rgb(0_0_0/0.35)]">
    <p className="text-muted-foreground m-0 font-mono text-[11px] tracking-[0.16em] uppercase">Сбой экрана</p>
    <h1 className="m-0 text-[22px] leading-tight font-semibold tracking-[-0.01em]">{errorTitle(error)}</h1>
    <p className="text-muted-foreground m-0 text-sm leading-relaxed">
     Переписка, звонки и настройки не пострадали: данные остались на сервере и в локальном хранилище. Продолжить можно с
     этого же места.
    </p>
    <pre className="border-border bg-foreground/[0.04] m-0 max-h-[180px] overflow-auto rounded-[10px] border p-3 font-mono text-[12.5px] leading-relaxed [overflow-wrap:anywhere] whitespace-pre-wrap">
     {errorSummary(error)}
    </pre>
    <div className="flex flex-wrap gap-2">
     <button
      type="button"
      ref={primary}
      className={`${BUTTON} ${PRIMARY} focus-visible:outline-ring min-h-[38px] focus-visible:outline-2 focus-visible:outline-offset-2`}
      onClick={onRetry}
     >
      Вернуться в приложение
     </button>
     <button
      type="button"
      className={`${BUTTON} ${SECONDARY} focus-visible:outline-ring min-h-[38px] focus-visible:outline-2 focus-visible:outline-offset-2`}
      onClick={onReload}
     >
      Перезагрузить
     </button>
     <button
      type="button"
      className={`${BUTTON} ${QUIET} focus-visible:outline-ring min-h-[38px] focus-visible:outline-2 focus-visible:outline-offset-2`}
      onClick={() => void copy()}
     >
      {copied === 'done' ? 'Скопировано' : copied === 'failed' ? 'Не удалось скопировать' : 'Скопировать текст ошибки'}
     </button>
    </div>
    <details className="border-border border-t pt-3">
     <summary className="text-muted-foreground cursor-pointer text-[13px]">Подробности для отчёта об ошибке</summary>
     <pre className="text-muted-foreground mt-2 max-h-[220px] overflow-auto font-mono text-[12px] leading-relaxed [overflow-wrap:anywhere] whitespace-pre-wrap">
      {errorDetails(error, componentStack)}
     </pre>
    </details>
   </section>
  </main>
 );
}
