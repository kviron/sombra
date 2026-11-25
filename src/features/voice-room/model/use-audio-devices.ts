import {useStore} from 'zustand';
import {useShallow} from 'zustand/react/shallow';
import {
 mediaDevicesStore,
 selectDevices,
 selectNeedsDeviceAccess,
 selectRemoteInputUnavailable
} from '@/shared/lib/media-devices';

export type {AudioDeviceContext} from '@/shared/api/tauri';

export function useAudioDevices(enabled = true, selectList = selectDevices) {
 return useStore(
  mediaDevicesStore,
  useShallow(current => {
   const state = enabled ? current : mediaDevicesStore.getInitialState();
   return {
    loaded: state.loaded,
    requesting: state.requesting,
    error: state.error,
    notice: state.notice,
    refresh: state.refresh,
    requestAccess: state.requestAccess,
    devices: enabled ? selectList(state) : state.devices,
    needsAccess: selectNeedsDeviceAccess(state),
    remoteInputUnavailable: selectRemoteInputUnavailable(state)
   };
  })
 );
}

/** An explicit preference is never silently replaced, even when labels/IDs are restricted. */
export function isDeviceSelectionMissing(
 devices: MediaDeviceInfo[],
 loaded: boolean,
 kind: MediaDeviceKind,
 selected: string
) {
 return (
  loaded &&
  !!selected &&
  !['default', 'communications'].includes(selected) &&
  !devices.some(device => device.kind === kind && device.deviceId === selected)
 );
}
