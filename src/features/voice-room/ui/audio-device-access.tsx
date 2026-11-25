import type {useAudioDevices} from '../model/use-audio-devices';

export function AudioDeviceAccess({
 devices,
 disabled: _disabled = false
}: {
 devices: ReturnType<typeof useAudioDevices>;
 disabled?: boolean;
}) {
 return (
  <div className="audio-device-access mx-0 mt-3 mb-4 min-w-0">
   {devices.remoteInputUnavailable && (
    <p
     role="status"
     className="audio-device-remote-info text-muted-foreground my-2 text-[12px] leading-[1.5] [overflow-wrap:anywhere]"
    >
     В удалённой сессии Windows микрофон не передан. В параметрах подключения RDP включите запись звука с этого
     компьютера, переподключитесь и обновите список.
    </p>
   )}
   {devices.needsAccess && !devices.remoteInputUnavailable && (
    <p className="text-muted-foreground my-2 text-[12px] leading-[1.5] [overflow-wrap:anywhere]">
     Чтобы увидеть микрофоны и динамики, разрешите доступ к микрофону. Проверочный поток сразу остановится.
    </p>
   )}
   {devices.error && !devices.remoteInputUnavailable && (
    <p
     role="alert"
     className="audio-device-error text-muted-foreground my-2 text-[12px] leading-[1.5] [overflow-wrap:anywhere]"
    >
     {devices.error}
    </p>
   )}
   {devices.notice && !devices.error && !devices.remoteInputUnavailable && (
    <p className="text-muted-foreground my-2 text-[12px] leading-[1.5] [overflow-wrap:anywhere]" role="status">
     {devices.notice}
    </p>
   )}
  </div>
 );
}
