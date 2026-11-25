import {recordDesktopDiagnostic} from './diagnostics';

/**
 * Сторож зависаний. Если главный поток занят, таймер не тикает, и следующий тик
 * приходит позже ожидаемого — разница и есть длительность блокировки. Запись
 * уходит в журнал диагностики (`webview/ui_freeze`), поэтому после зависания
 * в экспорте видно его время. Тот же смысл у PerformanceObserver: любая задача
 * дольше секунды помечается тем же событием.
 *
 * Сторож ничего не лечит: он нужен, чтобы следующее зависание было видно в
 * журнале, а не только на экране.
 */
const TICK_MS = 1000;
const FREEZE_THRESHOLD_MS = 2000;
const LONG_TASK_MS = 1000;

export function startFreezeWatchdog() {
 if (typeof window === 'undefined') return;
 let expected = performance.now() + TICK_MS;
 window.setInterval(() => {
  const now = performance.now();
  const lag = now - expected;
  expected = now + TICK_MS;
  if (lag >= FREEZE_THRESHOLD_MS) recordDesktopDiagnostic('webview', 'ui_freeze');
 }, TICK_MS);

 if (typeof PerformanceObserver !== 'function') return;
 try {
  const observer = new PerformanceObserver(list => {
   for (const entry of list.getEntries()) {
    if (entry.duration >= LONG_TASK_MS) recordDesktopDiagnostic('webview', 'ui_freeze');
   }
  });
  observer.observe({type: 'longtask', buffered: true});
 } catch {
  /* longtask не поддерживается — остаётся сторож по таймеру. */
 }
}
