import {useCallback,useEffect,useState,type ErrorInfo,type ReactNode} from 'react';
import {recordDesktopDiagnostic} from '@/shared/api/diagnostics';
import {ErrorBoundary} from './error-boundary';
import {ErrorScreen} from './error-screen';

/** Сбой по запросу — только в разработке: так экран ошибки можно посмотреть, не ломая код. */
function DevCrash(): never {
 throw new Error('Проверка границы ошибок: ?crash=1');
}

type Props = {children: ReactNode};

/**
 * Обёртка всего приложения: ловит ошибки отрисовки, пишет их в журнал диагностики,
 * показывает экран восстановления и пересобирает дерево при повторе.
 */
export function ErrorBoundaryProvider({children}: Props) {
 const [generation, setGeneration] = useState(0);
 const [crash, setCrash] = useState(false);

 // Падение по запросу случается после первого кадра, поэтому тема и шрифты уже применены.
 useEffect(() => {
  if (!import.meta.env.DEV || !new URLSearchParams(window.location.search).has('crash')) return;
  const timer = window.setTimeout(() => setCrash(true), 1200);
  return () => window.clearTimeout(timer);
 }, []);

 const report = useCallback((error: Error, info: ErrorInfo) => {
  recordDesktopDiagnostic('webview', 'render_error');
  if (import.meta.env.DEV) console.error('[Сомбра] сбой отрисовки', error, info.componentStack);
 }, []);

 const retry = useCallback(() => {
  // Новый ключ пересобирает дерево заново: так сбрасывается и состояние упавших компонентов.
  setCrash(false);
  setGeneration(value => value + 1);
 }, []);

 const reload = useCallback(() => window.location.reload(), []);

 return (
  <ErrorBoundary
   key={generation}
   onError={report}
   fallback={({error, componentStack}) => (
    <ErrorScreen error={error} componentStack={componentStack} onRetry={retry} onReload={reload} />
   )}
  >
   {crash ? <DevCrash /> : null}
   {children}
  </ErrorBoundary>
 );
}
