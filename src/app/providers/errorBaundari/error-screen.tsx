import {useEffect,useRef,useState} from 'react';
import {errorDetails, errorSummary, errorTitle} from './error-summary';
import './error-screen.css';

type Props = {
 error: Error;
 componentStack: string | null;
 onRetry: () => void;
 onReload: () => void;
};

/** Fallback без зависимостей от UI-кита: если сломался общий слой, экран всё равно должен собраться. */
export function ErrorScreen({error, componentStack, onRetry, onReload}: Props) {
 const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle');
 const [detailed, setDetailed] = useState(false);
 const primary = useRef<HTMLButtonElement | null>(null);

 // Фокус переезжает на главное действие: упавший элемент размонтирован, и без этого фокус теряется.
 useEffect(() => {
  primary.current?.focus();
 }, []);

 async function copy() {
  const text = errorDetails(error, componentStack);
  try {
   await navigator.clipboard.writeText(text);
   setCopied('done');
  } catch {
   setCopied('failed');
  }
  window.setTimeout(() => setCopied('idle'), 2500);
 }

 return (
  <main className="error-screen" role="alert" aria-live="assertive">
   <section className="error-screen-card">
    <p className="error-screen-eyebrow">Сбой экрана</p>
    <h1>{errorTitle(error)}</h1>
    <p>Переписка, звонки и настройки не пострадали: данные остались на сервере и в локальном хранилище. Продолжить можно с этого же места.</p>
    <pre className="error-screen-message">{errorSummary(error)}</pre>
    <div className="error-screen-actions">
     <button type="button" ref={primary} className="error-screen-button error-screen-button-primary" onClick={onRetry}>Вернуться в приложение</button>
     <button type="button" className="error-screen-button" onClick={onReload}>Перезагрузить</button>
     <button type="button" className="error-screen-button error-screen-button-quiet" onClick={() => void copy()}>
      {copied === 'done' ? 'Скопировано' : copied === 'failed' ? 'Не удалось скопировать' : 'Скопировать текст ошибки'}
     </button>
    </div>
    <details
     className="error-screen-details"
     open={detailed}
     onToggle={event => setDetailed((event.currentTarget as HTMLDetailsElement).open)}
    >
     <summary>Подробности для отчёта об ошибке</summary>
     <pre className="error-screen-stack">{errorDetails(error, componentStack)}</pre>
    </details>
   </section>
  </main>
 );
}
