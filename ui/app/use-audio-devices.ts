import {useEffect,useRef,useState} from 'react';

function deviceError(reason:unknown){
 const name=(reason as DOMException)?.name;
 if(name==='NotAllowedError'||name==='SecurityError')return 'Доступ к микрофону запрещён. Разрешите его для Sombra в настройках Windows или браузера, затем попробуйте снова.';
 if(name==='NotFoundError')return 'Микрофон не найден. Подключите устройство и обновите список.';
 if(name==='NotReadableError')return 'Не удалось открыть микрофон. Проверьте, не занят ли он другим приложением.';
 return 'Не удалось получить список устройств. Проверьте подключение и разрешения.';
}

/** Device IDs/labels are privacy-restricted until the user grants microphone access. */
export function useAudioDevices(enabled=true){
 const [devices,setDevices]=useState<MediaDeviceInfo[]>([]),[error,setError]=useState(''),[notice,setNotice]=useState(''),[requesting,setRequesting]=useState(false);
 const lifecycle=useRef(0),pending=useRef(false),available=useRef(enabled);
 available.current=enabled;
 const latestDevices=useRef(devices);latestDevices.current=devices;
 async function refresh(){
  const epoch=lifecycle.current;
  try{
   if(!navigator.mediaDevices?.enumerateDevices)throw new Error('Unavailable');
   const list=await navigator.mediaDevices.enumerateDevices();
   if(available.current&&lifecycle.current===epoch){setDevices(list);setError('')}
   return list;
  }catch(reason){if(available.current&&lifecycle.current===epoch)setError(deviceError(reason));return []}
 }
 useEffect(()=>{
  lifecycle.current++;pending.current=false;setRequesting(false);setError('');setNotice('');
  if(!enabled)return;
  void refresh();
  const change=()=>{setNotice('');void refresh()};
  navigator.mediaDevices?.addEventListener('devicechange',change);
  return()=>{lifecycle.current++;navigator.mediaDevices?.removeEventListener('devicechange',change)};
 },[enabled]);
 async function requestAccess(){
  if(pending.current||!available.current)return;
  pending.current=true;setRequesting(true);setError('');setNotice('');
  const epoch=lifecycle.current;
  let stream:MediaStream|undefined;
  try{
   if(!navigator.mediaDevices?.getUserMedia)throw new Error('Unavailable');
   // A user gesture is mandatory. Never request camera or microphone on menu open.
   const unlocked=latestDevices.current.some(device=>device.kind==='audioinput'&&device.deviceId&&device.label);
   if(!unlocked){
    stream=await navigator.mediaDevices.getUserMedia({audio:true,video:false});
    // Stop immediately: enumerateDevices can wait while the document is hidden.
    stream.getTracks().forEach(track=>track.stop());stream=undefined;
   }
   if(!available.current||lifecycle.current!==epoch)return;
   const list=await navigator.mediaDevices.enumerateDevices();
   if(available.current&&lifecycle.current===epoch){
    setDevices(list);
    if(!list.some(device=>(device.kind==='audioinput'||device.kind==='audiooutput')&&device.deviceId&&!['default','communications'].includes(device.deviceId)))setNotice('Дополнительные аудиоустройства не обнаружены. Проверьте их подключение.');
   }
  }catch(reason){if(available.current&&lifecycle.current===epoch)setError(deviceError(reason))}
  finally{
   stream?.getTracks().forEach(track=>track.stop());
   if(lifecycle.current===epoch){pending.current=false;if(available.current)setRequesting(false)}
  }
 }
 const needsAccess=!devices.some(device=>device.kind==='audioinput'&&device.deviceId&&device.label);
 return {devices,error,notice,requesting,needsAccess,refresh,requestAccess};
}
