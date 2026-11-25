import {createStore} from 'zustand/vanilla';
import type {AudioDeviceContext} from '@/shared/api/tauri';
import type {mediaDevicesService} from './service';

function deviceError(reason: unknown) {
 const name = (reason as DOMException)?.name;
 if (name === 'NotAllowedError' || name === 'SecurityError')
  return 'Доступ к микрофону запрещён. Разрешите его для Sombra в настройках Windows или браузера, затем попробуйте снова.';
 if (name === 'NotFoundError') return 'Микрофон не найден. Подключите устройство и обновите список.';
 if (name === 'NotReadableError') return 'Не удалось открыть микрофон. Проверьте, не занят ли он другим приложением.';
 return 'Не удалось получить список устройств. Проверьте подключение и разрешения.';
}

export type MediaDevicesState = {
 devices: MediaDeviceInfo[];
 loaded: boolean;
 loading: boolean;
 requesting: boolean;
 nativeContext: AudioDeviceContext | null;
 error: string;
 notice: string;
 refresh: () => Promise<MediaDeviceInfo[]>;
 requestAccess: () => Promise<void>;
};

function sameDevices(previous: MediaDeviceInfo[], next: MediaDeviceInfo[]) {
 return (
  previous.length === next.length &&
  previous.every((device, index) => {
   const other = next[index];
   return (
    device.kind === other.kind &&
    device.deviceId === other.deviceId &&
    device.groupId === other.groupId &&
    device.label === other.label
   );
  })
 );
}

export function createMediaDevicesStore(service: typeof mediaDevicesService) {
 return createStore<MediaDevicesState>((set, get) => {
  let pending: Promise<MediaDeviceInfo[]> | undefined;
  let refreshAgain = false;
  async function readDevices() {
   do {
    refreshAgain = false;
    const [result, context] = await Promise.allSettled([service.enumerate(), service.readContext()]);
    if (refreshAgain) continue;
    const nativeContext = context.status === 'fulfilled' ? context.value : null;
    if (result.status === 'fulfilled') {
     const devices = result.value;
     set(state => ({
      devices: sameDevices(state.devices, devices) ? state.devices : devices,
      nativeContext,
      loaded: true,
      notice: '',
      error: ''
     }));
    } else {
     set({nativeContext, error: deviceError(result.reason), notice: ''});
    }
   } while (refreshAgain);
   return get().devices;
  }
  function refresh() {
   if (pending) {
    // A device or its permissions may have changed since enumeration started.
    refreshAgain = true;
   } else {
    pending = Promise.resolve()
     .then(readDevices)
     .finally(() => {
      pending = undefined;
      set({loading: false});
     });
    set({loading: true});
   }
   return pending;
  }
  async function requestAccess() {
   if (get().requesting) return;
   set({requesting: true, error: '', notice: ''});
   try {
    await refresh();
    const {devices, nativeContext} = get();
    const unlocked = devices.some(device => device.kind === 'audioinput' && device.deviceId && device.label);
    if (!unlocked && !(nativeContext?.remoteSession && nativeContext.inputs === 0)) {
     let captureError = '';
     try {
      await service.requestMicrophoneAccess();
     } catch (reason) {
      captureError = deviceError(reason);
     }
     await refresh();
     if (captureError) set({error: captureError});
    }
    if (
     !get().error &&
     !get().devices.some(
      device =>
       device.kind !== 'videoinput' && device.deviceId && !['default', 'communications'].includes(device.deviceId)
     )
    )
     set({notice: 'Дополнительные аудиоустройства не обнаружены. Проверьте их подключение.'});
   } finally {
    set({requesting: false});
   }
  }
  return {
   devices: [],
   loaded: false,
   loading: false,
   requesting: false,
   nativeContext: null,
   error: '',
   notice: '',
   refresh,
   requestAccess
  };
 });
}
