import {mediaDevicesService} from './service';
import {createMediaDevicesStore} from './store';

export * from './selectors';
export const mediaDevicesStore = createMediaDevicesStore(mediaDevicesService);

// Capture can reveal names and IDs before the WebView delivers a devicechange.
export function refreshCapturedDevice(track: MediaStreamTrack) {
 const kind = track.kind === 'audio' ? 'audioinput' : 'videoinput';
 const {devices, refresh} = mediaDevicesStore.getState();
 const id = track.getSettings().deviceId;
 if (!devices.some(device => device.kind === kind && device.label && (!id || device.deviceId === id))) void refresh();
}

export function watchMediaDevices() {
 const {refresh} = mediaDevicesStore.getState();
 const media = navigator.mediaDevices;
 media?.addEventListener('devicechange', refresh);
 void refresh();
 return () => media?.removeEventListener('devicechange', refresh);
}
