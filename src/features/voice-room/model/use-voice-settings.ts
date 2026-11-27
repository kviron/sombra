import {useEffect} from 'react';
import {useStore} from 'zustand';
import {isDeviceSelectionMissing, useAudioDevices} from './use-audio-devices';
import type {Voice} from './use-voice';
import {voiceSettingsActions, voiceSettingsStore} from './voice-settings';
import {
 deviceKinds,
 deviceLabels,
 deviceOptions,
 devicePreferenceKeys,
 deviceResetLabels,
 deviceSelectDisabled,
 noiseOption,
 noiseOptions,
 testDisabled,
 type DevicePreferenceKey
} from './voice-settings-rules';

type Options = {voice: Voice};

/**
 * Единственное место проверки устройств: поток, ошибки и список выбора.
 * Компонент получает готовые поля и колбэки.
 */
export function useVoiceSettings({voice}: Options) {
 const audioDevices = useAudioDevices();
 const state = useStore(voiceSettingsStore);
 const preferences = voice.preferences;

 // Новая панель начинается с чистого состояния, уход освобождает устройство.
 useEffect(() => {
  voiceSettingsActions.reset();
  return () => voiceSettingsActions.stop();
 }, []);

 function chooseDevice(key: DevicePreferenceKey, value: string) {
  voiceSettingsActions.stop();
  voice.savePreferences(key, value);
 }

 function chooseNoise(value: string) {
  const option = noiseOption(value);
  if (!option) return;
  voiceSettingsActions.stop();
  voice.savePreferences('noise', option);
 }

 function chooseEcho(checked: boolean) {
  voiceSettingsActions.stop();
  voice.savePreferences('echo', checked);
 }

 const fields = deviceKinds.map((kind, index) => {
  const key = devicePreferenceKeys[index],
   value = preferences[key],
   missing =
    key === 'speaker'
     ? voice.speakerOutput !== value
     : isDeviceSelectionMissing(audioDevices.devices, audioDevices.loaded, kind, value);
  return {
   kind,
   key,
   label: deviceLabels[index],
   resetLabel: deviceResetLabels[index],
   value,
   missing,
   disabled: deviceSelectDisabled({busy: voice.busy, requesting: audioDevices.requesting}),
   options: deviceOptions(audioDevices.devices, kind, value, missing),
   select: (next: string) => chooseDevice(key, next),
   reset: () => chooseDevice(key, '')
  };
 });

 return {
  devices: audioDevices,
  preview: state.preview,
  error: state.error || (voice.room ? voice.error : ''),
  testDisabled: testDisabled({busy: state.busy, room: voice.room}),
  devicesDisabled: state.busy || voice.busy,
  fields,
  noiseOptions,
  applyNoise: chooseNoise,
  applyEcho: chooseEcho,
  stop: voiceSettingsActions.stop,
  testMicrophone: () => voiceSettingsActions.test({video: false, preferences, refreshDevices: audioDevices.refresh}),
  testCamera: () => voiceSettingsActions.test({video: true, preferences, refreshDevices: audioDevices.refresh})
 };
}

export type VoiceSettingsModel = ReturnType<typeof useVoiceSettings>;
