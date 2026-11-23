import {LoaderCircle, RefreshCw, Mic} from 'lucide-react';
import {Button} from '@/shared/ui/button';
import type {useAudioDevices} from '../model/use-audio-devices';
import './audio-device-access.css';

export function AudioDeviceAccess({
 devices,
 disabled = false
}: {
 devices: ReturnType<typeof useAudioDevices>;
 disabled?: boolean;
}) {
 return (
  <div className="audio-device-access mx-0 mt-3 mb-4 min-w-0">
   {devices.remoteInputUnavailable && (
    <p
     role="status"
     className="audio-device-remote-info my-2 text-[12px] leading-[1.5] [overflow-wrap:anywhere] text-[#b1b8c6]"
    >
     В удалённой сессии Windows микрофон не передан. В параметрах подключения RDP включите запись звука с этого
     компьютера, переподключитесь и обновите список.
    </p>
   )}
   {devices.needsAccess && !devices.remoteInputUnavailable && (
    <p className="my-2 text-[12px] leading-[1.5] [overflow-wrap:anywhere] text-[#b1b8c6]">
     Чтобы увидеть микрофоны и динамики, разрешите доступ к микрофону. Проверочный поток сразу остановится.
    </p>
   )}
   <Button
    type="button"
    variant="secondary"
    aria-label="Показать аудиоустройства"
    disabled={disabled || devices.requesting}
    onClick={() => void devices.requestAccess()}
   >
    {devices.requesting ? (
     <LoaderCircle size={15} className="animate-spin" />
    ) : devices.needsAccess ? (
     <Mic size={15} />
    ) : (
     <RefreshCw size={15} />
    )}{' '}
    {devices.requesting
     ? 'Получаем устройства…'
     : devices.needsAccess
       ? 'Показать устройства'
       : 'Обновить список устройств'}
   </Button>
   {devices.error && !devices.remoteInputUnavailable && (
    <p
     role="alert"
     className="audio-device-error my-2 text-[12px] leading-[1.5] [overflow-wrap:anywhere] text-[#b1b8c6]"
    >
     {devices.error}
    </p>
   )}
   {devices.notice && !devices.error && !devices.remoteInputUnavailable && (
    <p className="my-2 text-[12px] leading-[1.5] [overflow-wrap:anywhere] text-[#b1b8c6]" role="status">
     {devices.notice}
    </p>
   )}
  </div>
 );
}
