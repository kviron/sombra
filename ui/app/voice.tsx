import {Button} from '@/shared/ui/button';
import {Switch} from '@/shared/ui/switch';
import {Slider} from '@/shared/ui/slider';
import {Select} from '@/shared/ui/select';
import {Label} from '@/shared/ui/label';
import {Progress} from '@/shared/ui/progress';
import {Separator} from '@/shared/ui/separator';
import {useEffect,useRef,useState} from 'react';
import {Mic,MicOff,Headphones,Video,VideoOff,PhoneOff,Settings} from 'lucide-react';
import {audioConstraints,mediaError,type Voice} from './use-voice';
import './voice.css';
export function Media({stream,muted,volume,speaker}:{stream:MediaStream;muted:boolean;volume:number;speaker:string}){
 const ref=useRef<HTMLVideoElement>(null);const [blocked,setBlocked]=useState(false),[error,setError]=useState('');
 useEffect(()=>{const el=ref.current!;el.srcObject=stream;void el.play().catch(()=>setBlocked(true));return()=>{el.srcObject=null}},[stream]);
 useEffect(()=>{const el=ref.current!;el.volume=volume/100;if('setSinkId' in el)void (el as HTMLVideoElement&{setSinkId:(id:string)=>Promise<void>}).setSinkId(speaker).catch(()=>setError('Не удалось выбрать динамики. Проверьте настройки.'))},[volume,speaker]);
 return <><video ref={ref} autoPlay playsInline muted={muted}/>{blocked&&<Button variant="secondary" onClick={()=>void ref.current?.play().then(()=>setBlocked(false))}>Включить воспроизведение</Button>}{error&&<small role="alert">{error}</small>}</>
}
export function VoiceStage({voice:v,id,title,userName,me,onSettings}:{voice:Voice;id:string;title:string;userName:(id:string)=>string;me:string;onSettings:()=>void}){
 const joined=v.room===id;
 return <div className="voice-stage"><h1>{title}</h1><p>{joined?(v.peers.length?'Вы в голосовой комнате':'Вы в комнате. Пригласите друзей, чтобы начать общение.'):'Присоединитесь, чтобы общаться голосом и видео'}</p>
 {joined&&<div className="voice-grid"><div className="voice-tile">{v.camera&&v.local?<Media stream={v.local} muted volume={0} speaker=""/>:<div className="voice-avatar">{me[0]}</div>}<span>{me} · Вы {v.muted||v.deaf?'· микрофон выключен':''}</span></div>{v.peers.map(p=><div className="voice-tile" key={p.client}>{v.streams[p.client]&&<Media stream={v.streams[p.client]} muted volume={0} speaker=""/>}<span>{userName(p.user)} · {v.connections[p.client]==='connected'?'На связи':v.connections[p.client]==='failed'?'Нет соединения — перезайдите':'Подключение…'}</span></div>)}</div>}
 {v.error&&<p className="voice-error" role="alert">{v.error}</p>}
 <div className="voice-controls">{joined?<><Button variant="secondary" title={v.muted?'Включить микрофон':'Выключить микрофон'} aria-pressed={v.muted} onClick={v.toggleMic}>{v.muted?<MicOff/>:<Mic/>}</Button><Button variant="secondary" title="Отключить звук" aria-pressed={v.deaf} onClick={v.toggleDeaf}><Headphones/></Button><Button variant="secondary" disabled={v.busy} title={v.camera?'Выключить камеру':'Включить камеру'} onClick={()=>void v.toggleCamera()}>{v.camera?<Video/>:<VideoOff/>}</Button><Button variant="secondary" className="voice-hangup" title="Отключиться" onClick={v.leave}><PhoneOff/></Button></>:<Button variant="secondary" disabled={v.busy} onClick={()=>void v.join(id)}>{v.busy?'Подключение…':'Присоединиться к голосовому каналу'}</Button>}<Button variant="secondary" title="Настройки голоса и видео" onClick={onSettings}><Settings/></Button></div></div>
}
export function VoiceSettings({voice:v}:{voice:Voice}){
 const [devices,setDevices]=useState<MediaDeviceInfo[]>([]),[preview,setPreview]=useState<MediaStream|null>(null),[error,setError]=useState(''),[level,setLevel]=useState(0),[busy,setBusy]=useState(false);
 const owned=useRef<MediaStream|null>(null),epoch=useRef(0);const p=v.preferences;
 function stop(){epoch.current++;owned.current?.getTracks().forEach(t=>t.stop());owned.current=null;setPreview(null);setLevel(0)}
 useEffect(()=>{const refresh=()=>void navigator.mediaDevices?.enumerateDevices().then(setDevices).catch(()=>{});refresh();navigator.mediaDevices?.addEventListener('devicechange',refresh);return()=>{epoch.current++;owned.current?.getTracks().forEach(t=>t.stop());navigator.mediaDevices?.removeEventListener('devicechange',refresh)}},[]);
 useEffect(()=>{if(!preview)return;const ctx=new AudioContext(),analyser=ctx.createAnalyser();ctx.createMediaStreamSource(preview).connect(analyser);const data=new Uint8Array(analyser.fftSize);const timer=setInterval(()=>{analyser.getByteTimeDomainData(data);setLevel(Math.min(100,Math.max(...data.map(x=>Math.abs(x-128)))*3))},100);return()=>{clearInterval(timer);void ctx.close()}},[preview]);
 async function test(video:boolean){stop();const token=epoch.current;setBusy(true);setError('');try{if(!navigator.mediaDevices)throw new Error('Устройства доступны через HTTPS или localhost.');const stream=await navigator.mediaDevices.getUserMedia({audio:audioConstraints(p),video:video?{deviceId:p.camera?{exact:p.camera}:undefined}:false});if(token!==epoch.current){stream.getTracks().forEach(t=>t.stop());return}owned.current=stream;setPreview(stream);setDevices(await navigator.mediaDevices.enumerateDevices())}catch(e){setError(mediaError(e))}finally{setBusy(false)}}
 return <section className="voice-settings">
  <h2>Голос и видео</h2>
  <p>Выберите устройства и проверьте их перед входом в комнату.</p>
  {v.room&&<p>Вы в голосовой комнате. Для смены микрофона и обработки звука отключитесь и войдите снова.</p>}
  <div className="voice-device-fields">
   {(['audioinput','audiooutput','videoinput'] as const).map((kind,i)=>{
    const key=(['mic','speaker','camera'] as const)[i];
    const label=['Устройство ввода · микрофон','Устройство вывода · динамики','Камера'][i];
    return <div className="voice-field" key={kind}><Label htmlFor={`voice-${key}`}>{label}</Label>
     <Select id={`voice-${key}`} label={label} value={p[key]} onValueChange={value=>{stop();v.savePreferences({...p,[key]:value})}} options={[{value:'',label:'По умолчанию'},...devices.filter(d=>d.kind===kind&&d.deviceId).map((d,n)=>({value:d.deviceId,label:d.label||`Устройство ${n+1}`}))]}/>
    </div>;
   })}
  </div>
  <div className="voice-audio-fields">
   <div className="voice-field voice-volume"><Label id="voice-volume-label">Громкость собеседников · {p.volume}%</Label><Slider aria-label="Громкость собеседников" min={0} max={100} value={[p.volume]} onValueChange={([volume])=>v.savePreferences({...p,volume})}/></div>
   <div className="voice-processing">
    {(['echo','noise'] as const).map((key,i)=><div className="voice-switch" key={key}><Label htmlFor={`voice-${key}`}>{['Эхоподавление','Шумоподавление'][i]}</Label><Switch id={`voice-${key}`} checked={p[key]} onCheckedChange={checked=>v.savePreferences({...p,[key]:checked})}/></div>)}
   </div>
  </div>
  <Separator className="voice-divider"/>
  <h2>Проверка устройств</h2>
  <div className="voice-test-actions"><Button variant="secondary" disabled={busy||!!v.room} onClick={()=>void test(false)}>Проверить микрофон</Button><Button variant="secondary" disabled={busy||!!v.room} onClick={()=>void test(true)}>Проверить камеру</Button>{preview&&<Button variant="secondary" onClick={stop}>Остановить проверку</Button>}</div>
  <p>При проверке разрешите доступ к устройствам. Звук не передаётся другим участникам.</p>
  <Progress aria-label="Уровень микрофона" value={level}/>
  {preview?.getVideoTracks().length? <Media stream={preview} muted volume={0} speaker=""/>:null}
  {error&&<p role="alert">{error}</p>}
 </section>
}
