// Такт активности бота: окно истекает само, поэтому индикатору нужен собственный таймер.
// Хранилище фабричное: на экране одновременно живут два индикатора (над полем ввода и в
// транскрипте), у каждого свой канал, поэтому общий модульный такт был бы неверным.
import {createStore} from 'zustand/vanilla';

export type BotTypingClockState = {
 /** Текущее время в секундах: по нему окно считается истёкшим без нового опроса. */
 now: number;
 /** Момент первого наблюдения непрерывной активности в миллисекундах. */
 observedStart: number;
};

export function createBotTypingClock() {
 const store = createStore<BotTypingClockState>(() => ({now: Date.now() / 1000, observedStart: 0}));

 return {
  store,
  actions: {
   /** Тик после истечения окна: строка исчезает, не дожидаясь следующего опроса. */
   tick(now: number) {
    store.setState({now});
   },
   /**
    * Начало непрерывной активности: время идёт от первого наблюдения, а не от догадки
    * о проценте. Пустой ключ сбрасывает отсчёт.
    */
   restart(observedStart: number) {
    store.setState({observedStart});
   }
  }
 };
}
