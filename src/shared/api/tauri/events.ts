import {listen as tauriListen, type UnlistenFn} from '@tauri-apps/api/event';
import {getCurrentWebviewWindow} from '@tauri-apps/api/webviewWindow';
import {isTauri} from './environment';

export type {UnlistenFn};

/** Подписки на события окна: наружу отдаём уже распакованный payload. */
export const events = {
 async listen<T>(event: string, handler: (payload: T) => void): Promise<UnlistenFn> {
  if (!isTauri()) return () => {};
  return tauriListen<T>(event, message => handler(message.payload));
 },

 /** Событие приходит в конкретное окно — так работает попап уведомлений. */
 async listenCurrentWindow<T>(event: string, handler: (payload: T) => void): Promise<UnlistenFn> {
  if (!isTauri()) return () => {};
  return getCurrentWebviewWindow().listen<T>(event, message => handler(message.payload));
 }
};
