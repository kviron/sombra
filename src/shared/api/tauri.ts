import {isTauri} from '@tauri-apps/api/core';
import {getVersion} from '@tauri-apps/api/app';
import {openUrl} from '@tauri-apps/plugin-opener';

export {isTauri};

export function getAppVersion() {
 return getVersion();
}

export async function openExternal(url: string) {
 if (isTauri()) {
  await openUrl(url);
  return;
 }

 window.open(url, '_blank', 'noopener,noreferrer');
}
