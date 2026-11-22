import {invoke, Channel} from '@tauri-apps/api/core';

export {Channel};

export type UpdateInfo = {version: string; body?: string};
export type DiagnosticEntryRecord = {
 time: number;
 source: string;
 operation: string;
 category: string;
 status: number | null;
};
export type AudioDeviceContext = {input: string | null; output: string | null; sampleRate: number | null};
export type DownloadProgress = {received: number; total?: number};

/**
 * Все команды Rust-оболочки одним объектом: компоненты не вызывают invoke напрямую,
 * поэтому набор команд и их аргументы видно в одном месте.
 */
export const commands = {
 /** Единственный канал к серверу: остальное — вспомогательные команды оболочки. */
 remote: <T>(request: {op: string; token: string} & Record<string, unknown>) => invoke<T>('remote_api', {request}),

 diagnostics: {
  record: (operation: string, category: string) => invoke<void>('record_desktop_diagnostic', {operation, category}),
  read: <T>() => invoke<T[]>('read_local_diagnostics'),
  clear: () => invoke<void>('clear_local_diagnostics')
 },

 cache: {
  info: <T>() => invoke<T>('attachment_cache_info'),
  setLimit: <T>(limitMiB: number) => invoke<T>('set_attachment_cache_limit', {limitMiB}),
  clear: <T>() => invoke<T>('clear_attachment_cache')
 },

 updates: {
  check: () => invoke<UpdateInfo | null>('check_update'),
  download: (progress: Channel<DownloadProgress>) => invoke<void>('download_update', {progress}),
  install: () => invoke<void>('install_update'),
  restart: () => invoke<void>('restart_app'),
  configured: () => invoke<boolean>('updater_configured').catch(() => false)
 },

 notifications: {
  takeTarget: <T>() => invoke<T>('take_notification_target'),
  notify: (payload: Record<string, unknown>) => invoke<void>('notify_direct_message', payload),
  activate: (target: Record<string, unknown>) => invoke<void>('activate_message_notification', {target}),
  resizePopup: (height: number) => invoke<void>('resize_notification_popup', {height}),
  popupReady: () => invoke<void>('notification_popup_ready')
 },

 files: {
  saveAttachment: <T = void>(payload: {message: string}) => invoke<T>('save_message_attachment', payload)
 },

 audio: {
  deviceContext: <T>() => invoke<T>('audio_device_context')
 }
};
