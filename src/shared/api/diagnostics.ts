import {tauri} from './tauri';

export type VoiceTransportCategory =
 | 'ice_checking'
 | 'ice_connected'
 | 'ice_disconnected'
 | 'ice_failed'
 | 'path_direct'
 | 'path_relay'
 | 'audio_receive_stalled'
 | 'audio_receive_recovered'
 | 'audio_send_stalled'
 | 'audio_send_recovered';
type Categories = {
 webview: 'js_error' | 'unhandled_rejection' | 'render_error' | 'ui_freeze';
 voice_microphone: 'device_error' | 'device_permission';
 voice_camera: 'device_error' | 'device_permission';
 voice_speaker: 'device_error' | 'device_permission';
 voice_playback: 'autoplay_blocked' | 'playback_error';
 voice_transport: VoiceTransportCategory;
 voice_output:
  | 'mic_muted'
  | 'mic_unmuted'
  | 'output_deafened'
  | 'output_undeafened'
  | 'playback_failed'
  | 'output_device_failed'
  | 'input_device_failed';
};
export const desktopDiagnosticsAvailable = tauri.isTauri;
const lastReport = new Map<string, number>();

export function recordDesktopDiagnostic<K extends keyof Categories>(operation: K, category: Categories[K]) {
 if (!tauri.isTauri()) return;
 const key = `${operation}:${category}`;
 const time = performance.now();
 const previous = lastReport.get(key);
 const cooldown = operation === 'voice_transport' || operation === 'voice_output' ? 30_000 : 5_000;
 if (previous !== undefined && time - previous < cooldown) return;
 lastReport.set(key, time);
 void tauri.commands.diagnostics.record(operation, category).catch(() => {});
}

if (typeof window !== 'undefined' && tauri.isTauri()) {
 window.addEventListener('error', () => recordDesktopDiagnostic('webview', 'js_error'));
 window.addEventListener('unhandledrejection', () => recordDesktopDiagnostic('webview', 'unhandled_rejection'));
}
