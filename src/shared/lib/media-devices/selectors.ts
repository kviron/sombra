import type {MediaDevicesState} from './store';

export const selectDevices = (state: MediaDevicesState) => state.devices;
export const selectDevicesLoaded = (state: MediaDevicesState) => state.loaded;
export const selectDevicesLoading = (state: MediaDevicesState) => state.loading;
export const selectRequestingDeviceAccess = (state: MediaDevicesState) => state.requesting;
export const selectNeedsDeviceAccess = ({devices}: MediaDevicesState) =>
 !devices.some(device => device.kind === 'audioinput' && device.deviceId && device.label);
export const selectRemoteInputUnavailable = ({nativeContext}: MediaDevicesState) =>
 !!nativeContext?.remoteSession && nativeContext.inputs === 0;

function devicesOfKind(kind: MediaDeviceKind) {
 let previous: MediaDeviceInfo[] | undefined;
 let result: MediaDeviceInfo[] = [];
 return ({devices}: MediaDevicesState) => {
  if (previous !== devices) {
   previous = devices;
   const next = devices.filter(device => device.kind === kind);
   if (next.length !== result.length || next.some((device, i) => device !== result[i])) result = next;
  }
  return result;
 };
}
export const selectMicrophones = devicesOfKind('audioinput');
export const selectSpeakers = devicesOfKind('audiooutput');
export const selectCameras = devicesOfKind('videoinput');

export function selectSpeakerOutput(
 {devices, loaded}: Pick<MediaDevicesState, 'devices' | 'loaded'>,
 preferred: string
) {
 if (!loaded || !preferred || preferred === 'default') return preferred;
 return devices.some(device => device.kind === 'audiooutput' && device.deviceId === preferred) ? preferred : '';
}
