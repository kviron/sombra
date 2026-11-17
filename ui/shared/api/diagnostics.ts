import { invoke, isTauri } from '@tauri-apps/api/core';

type Operation = 'webview' | 'voice_microphone' | 'voice_camera' | 'voice_speaker' | 'voice_playback';
type Category = 'js_error' | 'unhandled_rejection' | 'device_error' | 'device_permission' | 'autoplay_blocked' | 'playback_error';
const lastReport = new Map<string, number>();

export function recordDesktopDiagnostic(operation: Operation, category: Category) {
  if (!isTauri()) return;
  const key = `${operation}:${category}`;
  const time = Date.now();
  if (time - (lastReport.get(key) ?? 0) < 5000) return;
  lastReport.set(key, time);
  void invoke('record_desktop_diagnostic', { operation, category }).catch(() => {});
}

if (typeof window !== 'undefined' && isTauri()) {
  window.addEventListener('error', () => recordDesktopDiagnostic('webview', 'js_error'));
  window.addEventListener('unhandledrejection', () => recordDesktopDiagnostic('webview', 'unhandled_rejection'));
}
