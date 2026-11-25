import {isTauri as tauriIsTauri} from '@tauri-apps/api/core';
import {getVersion} from '@tauri-apps/api/app';
import {openUrl} from '@tauri-apps/plugin-opener';

/** Запущено ли приложение в оболочке Tauri, а не в обычном браузере. */
export const isTauri = () => tauriIsTauri();

export const appVersion = () => getVersion();

export async function openExternal(url: string) {
 if (isTauri()) {
  await openUrl(url);
  return;
 }

 window.open(url, '_blank', 'noopener,noreferrer');
}
