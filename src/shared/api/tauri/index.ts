import {commands} from './commands';
import {appVersion, isTauri, openExternal} from './environment';
import {events} from './events';
import {window} from './window';

/**
 * Единственная точка входа к оболочке Tauri. За пределами этого каталога импортов
 * из `@tauri-apps/*` нет: смена команды или API оболочки правится здесь.
 */
export const tauri = {isTauri, appVersion, openExternal, window, commands, events};

export type {AudioDeviceContext, DiagnosticEntryRecord, DownloadProgress, UpdateInfo} from './commands';
export {Channel} from './commands';
export type {UnlistenFn} from './events';
export type {WindowResizeDirection} from './window';
