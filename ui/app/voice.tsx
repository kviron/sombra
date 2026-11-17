import {MotionIcon} from '../shared/ui/motion-icon';
import {Button} from '@/shared/ui/button';
import {Switch} from '@/shared/ui/switch';
import {Slider} from '@/shared/ui/slider';
import {Select} from '@/shared/ui/select';
import {useAudioDevices} from './use-audio-devices';
import {AudioDeviceAccess} from './audio-device-access';
import {Label} from '@/shared/ui/label';
import {Progress} from '@/shared/ui/progress';
import {Separator} from '@/shared/ui/separator';
import {useEffect,useMemo,useRef,useState} from 'react';
import {Mic,MicOff,Headphones,HeadphoneOff,Video,VideoOff,PhoneOff,Settings} from 'lucide-react';
import {mediaError,type Voice} from './use-voice';
import {captureVoiceStream,stopCapturedTrack,type NoiseSuppression} from './voice-input';
import {recordDesktopDiagnostic} from '@/shared/api/diagnostics';
import {UserAvatar} from '@/shared/ui/user-avatar';
import {UserContextMenu} from './user-menu';
import {useUserActions} from './user-actions';
import type {User} from '@/shared/api/backend';
import './voice.css';
type PlaybackGain={context:AudioContext;source:MediaStreamAudioSourceNode;gain:GainNode;output:MediaStreamAudioDestinationNode};
export function Media({stream,muted,volume,speaker,audioOnly=false}:{stream:MediaStream;muted:boolean;volume:number;speaker?:string;audioOnly?:boolean}){
 const ref=useRef<HTMLMediaElement>(null);const [blocked,setBlocked]=useState(false),[error,setError]=useState('');
 const processing=useRef<PlaybackGain|null>(null),[gainError,setGainError]=useState('');
 const audioTrack=stream.getAudioTracks()[0];
 const input=useMemo(()=>audioOnly?new MediaStream(audioTrack?[audioTrack]:[]):stream,[audioOnly,audioTrack,stream]);
 function playbackFailed(failure:unknown){
  if(failure instanceof DOMException&&failure.name==='AbortError')return;
  if(speaker!==undefined)recordDesktopDiagnostic('voice_playback',
   failure instanceof DOMException&&failure.name==='NotAllowedError'?'autoplay_blocked':'playback_error');
  setBlocked(true);
 }
 useEffect(()=>{
  const el=ref.current!;
  let active=true;
  el.srcObject=input;
  void el.play().then(()=>{if(active)setBlocked(false)},failure=>{if(active)playbackFailed(failure)});
  return()=>{
   active=false;
   el.srcObject=null;
   const graph=processing.current;
   if(graph){
    processing.current=null;
    graph.source.disconnect();
    graph.gain.disconnect();
    graph.output.stream.getTracks().forEach(track=>track.stop());
    void graph.context.close();
   }
  };
 },[input]);
 useEffect(()=>{
  const el=ref.current!;
  setGainError('');
  let context:AudioContext|undefined;
  if(volume>100&&!processing.current&&input.getAudioTracks().length){
   try{
    context=new AudioContext();
    const source=context.createMediaStreamSource(input),gain=context.createGain(),output=context.createMediaStreamDestination();
    source.connect(gain).connect(output);
    const graph={context,source,gain,output};
    processing.current=graph;
    // Keep the amplified audio on the same element so its output device and mute state still apply.
    el.srcObject=new MediaStream([...input.getVideoTracks(),...output.stream.getAudioTracks()]);
    void Promise.all([context.resume(),el.play()]).then(
     ()=>{if(processing.current===graph)setBlocked(false)},
     failure=>{if(processing.current===graph)playbackFailed(failure)},
    );
   }catch{
    if(context)void context.close();
    setGainError('Не удалось усилить звук.');
   }
  }
  const graph=processing.current;
  if(graph)graph.gain.gain.value=volume/100;
  el.volume=graph?1:Math.min(1,volume/100);
 },[input,volume]);
 useEffect(()=>{
  const el=ref.current!;
  let active=true;
  setError('');
  if(speaker!==undefined){
   if(el.setSinkId)void el.setSinkId(speaker).catch(error=>{
    if(active){
     recordDesktopDiagnostic('voice_speaker',error.name==='NotAllowedError'?'device_permission':'device_error');
     setError('Не удалось выбрать динамики. Проверьте настройки.');
    }
   });
   else if(speaker)setError('Выбор динамиков недоступен в этом режиме.');
  }
  return()=>{active=false};
 },[speaker]);
 async function resumePlayback(){
  try{
   const el=ref.current;
   if(el?.error&&el.srcObject){
    const playbackStream=el.srcObject;
    el.srcObject=null;
    el.srcObject=playbackStream;
   }
   await Promise.all([el?.play(),processing.current?.context.resume()]);
   setBlocked(false);
  }catch(failure){playbackFailed(failure)}
 }
 const attach=(element:HTMLMediaElement|null)=>{ref.current=element};
 const onError=()=>playbackFailed(ref.current?.error);
 return <>{audioOnly?<audio ref={attach} autoPlay muted={muted} onError={onError}/>:<video ref={attach} autoPlay playsInline muted={muted} onError={onError}/>}
  {blocked&&<Button variant="secondary" onClick={()=>void resumePlayback()}>Включить воспроизведение</Button>}{(error||gainError)&&<small role="alert">{error||gainError}</small>}</>
}
export function VoiceStage({voice:v,id,title,userName,me,meUser,users,onSettings}:{voice:Voice;id:string;title:string;userName:(id:string)=>string;me:string;meUser?:User;users?:User[];onSettings:()=>void}){
 const joined=v.room===id;
 const actions=useUserActions();
 const microphoneOff=v.muted||v.deaf;
 const selfIdentity:User=meUser??{id:'',name:me,bio:'',created_at:0,online:true};
 const selfTile=<div className="voice-tile">{v.camera&&v.local?<Media stream={v.local} muted volume={0}/>:<button type="button" className="voice-tile-avatar" title="Открыть профиль" onClick={()=>meUser&&actions?.openProfile(meUser.id)}><UserAvatar user={selfIdentity} size="xl"/></button>}<span>{me} · Вы {v.muted||v.deaf?'· микрофон выключен':''}</span></div>;
 return <div className="voice-stage"><h1>{title}</h1><p>{joined?(v.peers.length?'Вы в голосовой комнате':'Вы в комнате. Пригласите друзей, чтобы начать общение.'):'Присоединитесь, чтобы общаться голосом и видео'}</p>
 {joined&&<div className="voice-grid">{meUser?<UserContextMenu user={meUser}>{selfTile}</UserContextMenu>:selfTile}{v.peers.map(p=>{
  const identity:User=users?.find(user=>user.id===p.user)??{id:p.user,name:userName(p.user),bio:'',created_at:0,online:true};
  const tile=<div className="voice-tile">{v.streams[p.client]?<Media stream={v.streams[p.client]} muted volume={0}/>:<button type="button" className="voice-tile-avatar" title={`Профиль ${identity.name}`} onClick={()=>actions?.openProfile(identity.id)}><UserAvatar user={identity} size="xl"/></button>}<span>{identity.name} · {v.connections[p.client]==='connected'?'На связи':v.connections[p.client]==='failed'?'Нет соединения — перезайдите':'Подключение…'}</span></div>;
  return <UserContextMenu key={p.client} user={identity}>{tile}</UserContextMenu>;
 })}</div>}
 {v.error&&<p className="voice-error" role="alert">{v.error}</p>}
 <div className="voice-controls">{joined?<><Button variant="secondary" title={microphoneOff?'Включить микрофон':'Выключить микрофон'} aria-label="Микрофон" aria-pressed={microphoneOff} onClick={v.toggleMic}>{microphoneOff?<MotionIcon icon={MicOff} kind="device"/>:<MotionIcon icon={Mic} kind="device"/>}</Button><Button variant="secondary" title={v.deaf?'Включить звук':'Отключить звук'} aria-label="Наушники" aria-pressed={v.deaf} onClick={v.toggleDeaf}>{v.deaf?<MotionIcon icon={HeadphoneOff} kind="device"/>:<MotionIcon icon={Headphones} kind="device"/>}</Button><Button variant="secondary" disabled={v.busy} title={v.camera?'Выключить камеру':'Включить камеру'} onClick={()=>void v.toggleCamera()}>{v.camera?<Video/>:<VideoOff/>}</Button><Button variant="secondary" className="voice-hangup" title="Отключиться" onClick={v.leave}><PhoneOff/></Button></>:<Button variant="secondary" disabled={v.busy} onClick={()=>void v.join(id)}>{v.busy?'Подключение…':'Присоединиться к голосовому каналу'}</Button>}<Button variant="secondary" title="Настройки голоса и видео" onClick={onSettings}><MotionIcon icon={Settings} kind="settings"/></Button></div></div>
}
const noiseOptions:{value:NoiseSuppression;label:string}[]=[
 {value:'enhanced',label:'Усиленное (RNNoise)'},
 {value:'standard',label:'Стандартное'},
 {value:'off',label:'Выключено'},
];

export function VoiceSettings({voice:v}:{voice:Voice}){
 const audioDevices=useAudioDevices();
 const {devices}=audioDevices;
 const [preview,setPreview]=useState<MediaStream|null>(null),[error,setError]=useState(''),[level,setLevel]=useState(0),[busy,setBusy]=useState(false);
 const owned=useRef<MediaStream|null>(null),epoch=useRef(0);const p=v.preferences;
 function stop(){epoch.current++;owned.current?.getTracks().forEach(stopCapturedTrack);owned.current=null;setPreview(null);setLevel(0)}
 useEffect(()=>()=>{epoch.current++;owned.current?.getTracks().forEach(stopCapturedTrack)},[]);
 useEffect(()=>{if(!preview)return;const ctx=new AudioContext(),analyser=ctx.createAnalyser();ctx.createMediaStreamSource(preview).connect(analyser);const data=new Uint8Array(analyser.fftSize);const timer=setInterval(()=>{analyser.getByteTimeDomainData(data);setLevel(Math.min(100,Math.max(...data.map(x=>Math.abs(x-128)))*3))},100);return()=>{clearInterval(timer);void ctx.close()}},[preview]);
 async function test(video:boolean){stop();const token=epoch.current;setBusy(true);setError('');try{if(!navigator.mediaDevices)throw new Error('Устройства доступны через HTTPS или localhost.');const stream=await captureVoiceStream(p,video?{deviceId:p.camera?{exact:p.camera}:undefined}:false);if(token!==epoch.current){stream.getTracks().forEach(stopCapturedTrack);return}owned.current=stream;setPreview(stream);await audioDevices.refresh()}catch(e){recordDesktopDiagnostic(video?'voice_camera':'voice_microphone',(e as DOMException).name==='NotAllowedError'?'device_permission':'device_error');setError(mediaError(e))}finally{setBusy(false)}}
 return <section className="voice-settings">
  <h2>Голос и видео</h2>
  <p>{v.room?'Устройства можно менять прямо во время звонка.':'Выберите устройства и проверьте их перед входом в комнату.'}</p>
  <AudioDeviceAccess devices={audioDevices} disabled={busy||v.busy}/>
  <div className="voice-device-fields">
   {(['audioinput','audiooutput','videoinput'] as const).map((kind,i)=>{
    const key=(['mic','speaker','camera'] as const)[i];
    const label=['Устройство ввода · микрофон','Устройство вывода · динамики','Камера'][i];
    const options=[{value:'',label:'По умолчанию'},...devices.filter(d=>d.kind===kind&&d.deviceId).map((d,n)=>({value:d.deviceId,label:d.label||`Устройство ${n+1}`}))];
    if(p[key]&&!options.some(option=>option.value===p[key]))options.push({value:p[key],label:'Выбранное устройство (недоступно)'});
    return <div className="voice-field" key={kind}><Label htmlFor={`voice-${key}`}>{label}</Label>
     <Select id={`voice-${key}`} label={label} value={p[key]} disabled={v.busy||audioDevices.requesting} onValueChange={value=>{stop();v.savePreferences(key,value)}} options={options}/>
    </div>;
   })}
  </div>
  <div className="voice-audio-fields">
   <div className="voice-field voice-volume"><Label id="voice-volume-label">Громкость собеседников · {p.volume}%</Label><Slider aria-label="Громкость собеседников" min={0} max={100} value={[p.volume]} onValueChange={([volume])=>v.savePreferences('volume',volume)}/></div>
   <div className="voice-processing">
    <div className="voice-switch"><Label htmlFor="voice-echo">Эхоподавление</Label>
     <Switch id="voice-echo" disabled={v.busy} checked={p.echo} onCheckedChange={checked=>{stop();v.savePreferences('echo',checked)}}/>
    </div>
    <div className="voice-field"><Label htmlFor="voice-noise">Шумоподавление</Label>
     <Select id="voice-noise" label="Шумоподавление" value={p.noise} disabled={v.busy} options={noiseOptions}
      onValueChange={value=>{const option=noiseOptions.find(option=>option.value===value);if(option){stop();v.savePreferences('noise',option.value)}}}/>
    </div>
   </div>
  </div>
  <Separator className="voice-divider"/>
  <h2>Проверка устройств</h2>
  <div className="voice-test-actions"><Button variant="secondary" disabled={busy||!!v.room} onClick={()=>void test(false)}>Проверить микрофон</Button><Button variant="secondary" disabled={busy||!!v.room} onClick={()=>void test(true)}>Проверить камеру</Button>{preview&&<Button variant="secondary" onClick={stop}>Остановить проверку</Button>}</div>
  <p>При проверке разрешите доступ к устройствам. Звук не передаётся другим участникам.</p>
  <Progress aria-label="Уровень микрофона" value={level}/>
  {preview?.getVideoTracks().length? <Media stream={preview} muted volume={0}/>:null}
  {(error||v.room&&v.error)&&<p role="alert">{error||v.error}</p>}
 </section>
}
