import {createStore} from 'zustand/vanilla';
import {recordDesktopDiagnostic} from '@/shared/api/diagnostics';
import {mediaError} from './voice-capture';
import {captureVoiceStream, stopCapturedTrack, type MediaPreferences} from './voice-input';

/** Проверка устройств в панели: поток, ошибка и признак работы. */
export type VoiceSettingsState = {
 preview: MediaStream | null;
 error: string;
 busy: boolean;
};

const initialState: VoiceSettingsState = {
 preview: null,
 error: '',
 busy: false
};

export const voiceSettingsStore = createStore<VoiceSettingsState>(() => initialState);

/** Поколение проверки: ответ устройства после отмены не должен попасть в интерфейс. */
let epoch = 0;

const stopPreview = (preview: MediaStream) => preview.getTracks().forEach(stopCapturedTrack);

export type TestArgs = {
 video: boolean;
 preferences: MediaPreferences;
 refreshDevices: () => Promise<unknown>;
};

export const voiceSettingsActions = {
 reset() {
  voiceSettingsStore.setState(initialState, true);
 },

 /** Останавливает проверку и освобождает устройство. */
 stop() {
  epoch++;
  const {preview} = voiceSettingsStore.getState();
  if (preview) stopPreview(preview);
  voiceSettingsStore.setState({preview: null});
 },

 /**
  * Проверка микрофона или камеры: тем же путём, что и звонок, но поток не уходит участникам.
  * Сеть и доступ к устройству — здесь, а не в компоненте.
  */
 async test({video, preferences, refreshDevices}: TestArgs) {
  voiceSettingsActions.stop();
  const token = epoch;
  voiceSettingsStore.setState({busy: true, error: ''});
  try {
   if (!navigator.mediaDevices) throw new Error('Устройства доступны через HTTPS или localhost.');
   const stream = await (video
    ? navigator.mediaDevices.getUserMedia({
       audio: false,
       video: {deviceId: preferences.camera ? {exact: preferences.camera} : undefined}
      })
    : captureVoiceStream(preferences, false));
   if (token !== epoch) {
    stopPreview(stream);
    return;
   }
   voiceSettingsStore.setState({preview: stream});
   await refreshDevices();
  } catch (reason) {
   recordDesktopDiagnostic(
    video ? 'voice_camera' : 'voice_microphone',
    (reason as DOMException).name === 'NotAllowedError' ? 'device_permission' : 'device_error'
   );
   voiceSettingsStore.setState({error: mediaError(reason)});
  } finally {
   voiceSettingsStore.setState({busy: false});
  }
 }
};
