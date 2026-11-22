import {useEffect, useRef, useState} from 'react';
import {tauri} from '@/shared/api';

export type AudioDeviceContext = {
 remoteSession: boolean;
 inputs: number;
 outputs: number;
 defaultInput: boolean;
 defaultOutput: boolean;
};
function deviceError(reason: unknown) {
 const name = (reason as DOMException)?.name;
 if (name === 'NotAllowedError' || name === 'SecurityError')
  return 'Доступ к микрофону запрещён. Разрешите его для Sombra в настройках Windows или браузера, затем попробуйте снова.';
 if (name === 'NotFoundError') return 'Микрофон не найден. Подключите устройство и обновите список.';
 if (name === 'NotReadableError') return 'Не удалось открыть микрофон. Проверьте, не занят ли он другим приложением.';
 return 'Не удалось получить список устройств. Проверьте подключение и разрешения.';
}

/** Device IDs/labels are privacy-restricted until the user grants microphone access. */
export function useAudioDevices(enabled = true) {
 const [devices, setDevices] = useState<MediaDeviceInfo[]>([]),
  [error, setError] = useState(''),
  [notice, setNotice] = useState(''),
  [requesting, setRequesting] = useState(false);
 const [nativeContext, setNativeContext] = useState<AudioDeviceContext | null>(null),
  [loaded, setLoaded] = useState(false);
 const lifecycle = useRef(0),
  pending = useRef(false),
  available = useRef(enabled),
  refreshSequence = useRef(0);
 available.current = enabled;
 const latestDevices = useRef(devices);
 latestDevices.current = devices;
 const current = (epoch: number) => available.current && lifecycle.current === epoch;
 async function readContext(epoch: number) {
  let context: AudioDeviceContext | null = null;
  if (tauri.isTauri())
   try {
    context = await tauri.commands.audio.deviceContext<AudioDeviceContext>();
   } catch {
    /* Older native versions and browser previews have no context command. */
   }
  if (current(epoch)) setNativeContext(context);
  return context;
 }
 async function enumerate(epoch: number, preserveError = false) {
  const sequence = ++refreshSequence.current;
  try {
   if (!navigator.mediaDevices?.enumerateDevices) throw new Error('Unavailable');
   const list = await navigator.mediaDevices.enumerateDevices();
   if (current(epoch) && sequence === refreshSequence.current) {
    setDevices(list);
    latestDevices.current = list;
    setLoaded(true);
    if (!preserveError) setError('');
   }
   return list;
  } catch (reason) {
   if (current(epoch) && sequence === refreshSequence.current && !preserveError) setError(deviceError(reason));
   return [];
  }
 }
 async function refresh() {
  const epoch = lifecycle.current;
  // Native context is read-only; refreshing never activates any hardware.
  const list = enumerate(epoch, pending.current);
  await readContext(epoch);
  return list;
 }
 useEffect(() => {
  lifecycle.current++;
  pending.current = false;
  setRequesting(false);
  setError('');
  setNotice('');
  setLoaded(false);
  setNativeContext(null);
  if (!enabled) return;
  void refresh();
  const change = () => {
   setNotice('');
   void refresh();
  };
  navigator.mediaDevices?.addEventListener('devicechange', change);
  return () => {
   lifecycle.current++;
   navigator.mediaDevices?.removeEventListener('devicechange', change);
  };
 }, [enabled]);
 async function requestAccess() {
  if (pending.current || !available.current) return;
  pending.current = true;
  setRequesting(true);
  setError('');
  setNotice('');
  const epoch = lifecycle.current;
  let stream: MediaStream | undefined;
  let captureFailed = false;
  try {
   const context = await readContext(epoch);
   if (!current(epoch)) return;
   const unlocked = latestDevices.current.some(
    device => device.kind === 'audioinput' && device.deviceId && device.label
   );
   if (!unlocked && !(context?.remoteSession && context.inputs === 0)) {
    try {
     if (!navigator.mediaDevices?.getUserMedia) throw new Error('Unavailable');
     // Only this user action probes access. Never retry another input after denial.
     stream = await navigator.mediaDevices.getUserMedia({audio: true, video: false});
     // Stop immediately, including late resolutions, before any enumeration.
     stream.getTracks().forEach(track => track.stop());
     stream = undefined;
    } catch (reason) {
     captureFailed = true;
     if (current(epoch)) setError(deviceError(reason));
    }
   }
   if (!current(epoch)) return;
   // A missing/denied microphone must not prevent speakers or cameras refreshing.
   const list = await enumerate(epoch, captureFailed);
   if (
    current(epoch) &&
    !captureFailed &&
    !list.some(
     device =>
      (device.kind === 'audioinput' || device.kind === 'audiooutput') &&
      device.deviceId &&
      !['default', 'communications'].includes(device.deviceId)
    )
   )
    setNotice('Дополнительные аудиоустройства не обнаружены. Проверьте их подключение.');
  } finally {
   stream?.getTracks().forEach(track => track.stop());
   if (lifecycle.current === epoch) {
    pending.current = false;
    if (available.current) setRequesting(false);
   }
  }
 }
 const needsAccess = !devices.some(device => device.kind === 'audioinput' && device.deviceId && device.label);
 const remoteInputUnavailable = !!nativeContext?.remoteSession && nativeContext.inputs === 0;
 return {
  devices,
  error,
  notice,
  requesting,
  needsAccess,
  loaded,
  nativeContext,
  remoteInputUnavailable,
  refresh,
  requestAccess
 };
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
