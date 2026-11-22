import {useState} from 'react';
import {useStore} from 'zustand';
import {isDeviceSelectionMissing, useAudioDevices} from './use-audio-devices';
import {createVoiceQuickSettingsModel} from './voice-quick-settings';
import {
 deviceOptions,
 quickDeviceKind,
 quickLabels,
 quickPreferenceKey,
 quickVolume,
 quickVolumeMax,
 type QuickSettingsKind
} from './voice-quick-settings-rules';
import type {Voice} from './use-voice';

type Options = {voice: Voice; kind: QuickSettingsKind; onSettings: () => void};

/**
 * Единственное место, где живёт логика быстрых настроек: открытие, список устройств и
 * громкость. Компонент получает готовые данные и колбэки.
 */
export function useVoiceQuickSettings({voice, kind, onSettings}: Options) {
 const [model] = useState(() => createVoiceQuickSettingsModel());
 const {open} = useStore(model.store);
 const audioDevices = useAudioDevices(open);
 const labels = quickLabels(kind);
 const preferenceKey = quickPreferenceKey(kind);
 const selected = voice.preferences[preferenceKey];
 const missing = isDeviceSelectionMissing(audioDevices.devices, audioDevices.loaded, quickDeviceKind(kind), selected);

 return {
  open,
  labels,
  audioDevices,
  selected,
  missing,
  options: deviceOptions({devices: audioDevices.devices, kind, selected, missing}),
  disabled: voice.busy || audioDevices.requesting,
  volume: quickVolume(kind, voice),
  volumeMax: quickVolumeMax(kind),
  setOpen: model.actions.setOpen,
  setDevice: (value: string) => voice.savePreferences(preferenceKey, value),
  resetDevice: () => voice.savePreferences(preferenceKey, ''),
  setVolume: (value: number) => (kind === 'input' ? voice.setMicVolume(value) : voice.savePreferences('volume', value)),
  openSettings: () => model.actions.openSettings(onSettings)
 };
}

export type VoiceQuickSettingsViewModel = ReturnType<typeof useVoiceQuickSettings>;
