import {tauri} from '@/shared/api';
import type {AudioDeviceContext} from '@/shared/api/tauri';

export const mediaDevicesService = {
 async enumerate() {
  return navigator.mediaDevices.enumerateDevices();
 },
 async readContext(): Promise<AudioDeviceContext | null> {
  return tauri.isTauri() ? tauri.commands.audio.deviceContext() : null;
 },
 async requestMicrophoneAccess() {
  const stream = await navigator.mediaDevices.getUserMedia({audio: true, video: false});
  stream.getTracks().forEach(track => track.stop());
 }
};
