import {useEffect,useState} from 'react';
import {Popover} from 'radix-ui';
import {ChevronUp,Settings} from 'lucide-react';
import {Button} from '@/shared/ui/button';
import {Select} from '@/shared/ui/select';
import {Slider} from '@/shared/ui/slider';
import {Separator} from '@/shared/ui/separator';
import type {Voice} from './use-voice';
import './voice-quick-settings.css';

export function VoiceQuickSettings({voice,kind,onSettings}:{voice:Voice;kind:'input'|'output';onSettings:()=>void}){
 const [open,setOpen]=useState(false);
 const [devices,setDevices]=useState<MediaDeviceInfo[]>([]);
 const [error,setError]=useState('');
 const input=kind==='input';
 const key=input?'mic':'speaker';
 const label=input?'Устройство ввода':'Устройство вывода';
 const volumeLabel=input?'Громкость микрофона':'Громкость звука';
 const volume=input?voice.micVolume:voice.preferences.volume;
 useEffect(()=>{
  if(!open)return;
  let active=true;
  async function refresh(){
   try{
    if(!navigator.mediaDevices)throw new Error('Устройства доступны через HTTPS или localhost.');
    const list=await navigator.mediaDevices.enumerateDevices();
    if(active){setDevices(list);setError('')}
   }catch{if(active)setError('Не удалось получить список устройств. Проверьте разрешения в настройках голоса.')}
  }
  void refresh();
  navigator.mediaDevices?.addEventListener('devicechange',refresh);
  return()=>{active=false;navigator.mediaDevices?.removeEventListener('devicechange',refresh)};
 },[open]);
 const matching=devices.filter(device=>device.kind===(input?'audioinput':'audiooutput')&&device.deviceId&&device.deviceId!=='default');
 const selected=voice.preferences[key];
 const options=[{value:'',label:'По умолчанию'},...matching.map((device,index)=>({value:device.deviceId,label:device.label||`${input?'Микрофон':'Динамики'} ${index+1}`}))];
 if(selected&&!options.some(option=>option.value===selected))options.push({value:selected,label:'Выбранное устройство (недоступно)'});
 return <Popover.Root open={open} onOpenChange={setOpen}>
  <Popover.Trigger asChild><Button type="button" variant="ghost" size="icon-xs" className="voice-quick-trigger" aria-label={input?'Быстрые настройки микрофона':'Быстрые настройки наушников'} title={input?'Настройки микрофона':'Настройки наушников'}><ChevronUp size={12}/></Button></Popover.Trigger>
  <Popover.Portal><Popover.Content side="top" align="end" sideOffset={10} collisionPadding={12} className="voice-quick-panel sombra-menu-surface dark" data-slot="popover-content" aria-label={input?'Быстрые настройки микрофона':'Быстрые настройки наушников'}>
   <label className="voice-quick-label" htmlFor={`quick-${kind}-device`}>{label}</label>
   <Select id={`quick-${kind}-device`} label={label} value={selected} disabled={voice.busy} options={options} onValueChange={value=>voice.savePreferences(key,value)}/>
   {error&&<p className="voice-quick-error" role="status">{error}</p>}
   <Separator className="my-4"/>
   <div className="voice-quick-volume"><label id={`quick-${kind}-volume`}>{volumeLabel}</label><output>{volume}%</output></div>
   <Slider aria-labelledby={`quick-${kind}-volume`} min={0} max={input?200:100} value={[volume]} onValueChange={([value])=>input?voice.setMicVolume(value):voice.savePreferences('volume',value)}/>
   <Separator className="my-4"/>
   <Button type="button" variant="ghost" className="voice-quick-settings-link" onClick={()=>{setOpen(false);onSettings()}}><Settings size={16}/>Настройки голоса</Button>
  </Popover.Content></Popover.Portal>
 </Popover.Root>;
}
