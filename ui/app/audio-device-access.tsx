import {LoaderCircle,RefreshCw,Mic} from 'lucide-react';
import {Button} from '@/shared/ui/button';
import type {useAudioDevices} from './use-audio-devices';
import './audio-device-access.css';

export function AudioDeviceAccess({devices,disabled=false}:{devices:ReturnType<typeof useAudioDevices>;disabled?:boolean}){
 return <div className="audio-device-access">
  {devices.remoteInputUnavailable&&<p role="status" className="audio-device-remote-info">В удалённой сессии Windows микрофон не передан. В параметрах подключения RDP включите запись звука с этого компьютера, переподключитесь и обновите список.</p>}
   {devices.needsAccess&&!devices.remoteInputUnavailable&&<p>Чтобы увидеть микрофоны и динамики, разрешите доступ к микрофону. Проверочный поток сразу остановится.</p>}
  <Button type="button" variant="secondary" aria-label="Показать аудиоустройства" disabled={disabled||devices.requesting} onClick={()=>void devices.requestAccess()}>{devices.requesting?<LoaderCircle size={15} className="animate-spin"/>:devices.needsAccess?<Mic size={15}/>:<RefreshCw size={15}/>} {devices.requesting?'Получаем устройства…':devices.needsAccess?'Показать устройства':'Обновить список устройств'}</Button>
  {devices.error&&!devices.remoteInputUnavailable&&<p role="alert" className="audio-device-error">{devices.error}</p>}
  {devices.notice&&!devices.error&&!devices.remoteInputUnavailable&&<p role="status">{devices.notice}</p>}
 </div>;
}
