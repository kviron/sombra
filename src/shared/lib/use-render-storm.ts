import {useRef} from 'react';

type Storm = {window: number; count: number; reported: number};

/**
 * Диагностика зависаний в dev-сборке: если компонент рендерится десятки раз за
 * секунду, в консоль уходит одна строка с его именем. Шум исчезает в релизе —
 * в проде счётчик выключен, а стоимость одного инкремента на рендер нулевая.
 *
 * Нужен, чтобы цикл перерисовок называл себя сам: без этого зависание оставляет
 * только косвенные следы вроде одинаковых ключей в списке.
 */
export function useRenderStorm(name: string) {
 const state = useRef<Storm>({window: 0, count: 0, reported: 0});
 if (!import.meta.env.DEV) return;
 const now = performance.now();
 const storm = state.current;
 if (now - storm.window > 1000) {
  storm.window = now;
  storm.count = 0;
 }
 storm.count++;
 if (storm.count >= 60 && now - storm.reported > 5000) {
  storm.reported = now;
  console.error(`[render-storm] ${name}: ${storm.count} рендеров за секунду`);
 }
}
