import {getCurrentWindow} from '@tauri-apps/api/window';
import {isTauri} from './environment';

type AppWindow = ReturnType<typeof getCurrentWindow>;
export type WindowResizeDirection = Parameters<AppWindow['startResizeDragging']>[0];

async function run(action: (appWindow: AppWindow) => Promise<void>) {
 if (!isTauri()) return;
 try {
  await action(getCurrentWindow());
 } catch (error) {
  console.error('Ошибка действия с окном:', error);
 }
}

/** Всё, что приложение делает с собственным окном. */
export const window = {
 startDrag: () => run(appWindow => appWindow.startDragging()),
 minimize: () => run(appWindow => appWindow.minimize()),
 toggleMaximize: () => run(appWindow => appWindow.toggleMaximize()),
 close: () => run(appWindow => appWindow.close()),
 startResize: (direction: WindowResizeDirection) => run(appWindow => appWindow.startResizeDragging(direction)),
 async isMaximized() {
  if (!isTauri()) return false;
  try {
   return await getCurrentWindow().isMaximized();
  } catch {
   return false;
  }
 },
 async isFocused() {
  if (!isTauri()) return true;
  try {
   return await getCurrentWindow().isFocused();
  } catch {
   return true;
  }
 },
 /** Возвращает функцию отписки; без Tauri отписываться не от чего. */
 async onResized(handler: () => void) {
  if (!isTauri()) return () => {};
  try {
   return await getCurrentWindow().onResized(handler);
  } catch {
   return () => {};
  }
 }
};
