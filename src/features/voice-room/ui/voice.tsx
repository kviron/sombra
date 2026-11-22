import {MotionIcon} from '@/shared/ui/motion-icon';
import {Button} from '@/shared/ui/button';
import {Switch} from '@/shared/ui/switch';
import {Slider} from '@/shared/ui/slider';
import {Select} from '@/shared/ui/select';
import {useAudioDevices,isDeviceSelectionMissing} from '../model/use-audio-devices';
import {AudioDeviceAccess} from './audio-device-access';
import {Label} from '@/shared/ui/label';
import {Progress} from '@/shared/ui/progress';
import {useEffect,useMemo,useRef,useState} from 'react';
import {Mic,MicOff,Headphones,HeadphoneOff,Video,VideoOff,PhoneOff,Settings} from 'lucide-react';
import {mediaError,type Voice} from '../model/use-voice';
import {captureVoiceStream,stopCapturedTrack,type NoiseSuppression} from '../model/voice-input';
import {recordDesktopDiagnostic} from '@/shared/api/diagnostics';
import {UserAvatar} from '@/shared/ui/user-avatar';
import {UserContextMenu} from '@/entities/user';
import {useUserActions} from '@/shared/lib/user-actions';
import type {User} from '@/shared/api/backend';
import './voice.css';
import '@/shared/ui/account-media-settings.css';
import {RoomMusic,type useRoomMusic} from './room-music';
type PlaybackGain={context:AudioContext;source:MediaStreamAudioSourceNode;gain:GainNode;output:MediaStreamAudioDestinationNode};
export function Media({stream,muted,volume,speaker,audioOnly=false}:{stream:MediaStream;muted:boolean;volume:number;speaker?:string;audioOnly?:boolean}){
 const ref=useRef<HTMLMediaElement>(null);const [blocked,setBlocked]=useState(false),[error,setError]=useState('');
 const processing=useRef<PlaybackGain|null>(null),[gainError,setGainError]=useState('');
 // Receiver streams can gain/replace audio without changing their MediaStream identity.
 const [,refreshAudio]=useState(0);
 const audioTrack=stream.getAudioTracks().find(track=>track.readyState==='live');
 useEffect(()=>{
  const sync=()=>refreshAudio(value=>value+1);
  stream.addEventListener('addtrack',sync);stream.addEventListener('removetrack',sync);
  return()=>{stream.removeEventListener('addtrack',sync);stream.removeEventListener('removetrack',sync)};
 },[stream]);
 // Video-only updates must not detach an otherwise unchanged audio receiver.
 const audioInput=useMemo(()=>new MediaStream(audioTrack?[audioTrack]:[]),[audioTrack]);
 const input=audioOnly?audioInput:stream;
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
  const play=()=>{void el.play().then(()=>{if(active)setBlocked(false)},failure=>{if(active)playbackFailed(failure)})};
   const receiver=audioOnly?input.getAudioTracks()[0]:undefined;
   const retryWhenReceiving=()=>{if(active&&el.paused)play()};
   receiver?.addEventListener('unmute',retryWhenReceiving);
   play();
  return()=>{
   active=false;
   receiver?.removeEventListener('unmute',retryWhenReceiving);
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
    if(speaker!==undefined)recordDesktopDiagnostic('voice_output','playback_failed');
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
   else if(speaker){
    recordDesktopDiagnostic('voice_output','output_device_failed');
    setError('Выбор динамиков недоступен в этом режиме.');
   }
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
// This is call-session infrastructure, not part of the selected conversation/stage.
// Keep one audible element per room/client; visual tiles always remain muted.
export function VoicePlayback({voice,volumeForUser}:{voice:Voice;volumeForUser:(id:string)=>number}){
 return <div className="voice-playback" data-voice-room={voice.room}>{Object.entries(voice.streams).map(([client,stream])=>{
  // WebRTC can deliver video before audio. Don't start playback on an empty stream.
   if(!stream.getAudioTracks().some(track=>track.readyState==='live'))return null;
   const peer=voice.peers.find(peer=>peer.client===client);
  const volume=voice.preferences.volume*(peer?volumeForUser(peer.user)/100:1);
  return <Media key={`${voice.room}:${client}`} stream={stream} muted={voice.deaf} volume={volume} speaker={voice.preferences.speaker} audioOnly/>;
 })}</div>;
}
export function hasVisibleVideo(stream?:MediaStream):boolean{
 return !!stream?.getVideoTracks().some(track=>track.readyState==='live'&&track.enabled&&!track.muted);
}
export function VoicePeerVisual({stream,user,onOpen}:{stream?:MediaStream;user:User;onOpen:()=>void}){
 const [,refresh]=useState(0);
 useEffect(()=>{
  if(!stream)return;
  let watched:MediaStreamTrack[]=[];
  const changed=()=>refresh(value=>value+1);
  const sync=()=>{
   for(const track of watched)for(const event of ['mute','unmute','ended'])track.removeEventListener(event,changed);
   watched=stream.getVideoTracks();
   for(const track of watched)for(const event of ['mute','unmute','ended'])track.addEventListener(event,changed);
   changed();
  };
  stream.addEventListener('addtrack',sync);stream.addEventListener('removetrack',sync);sync();
  return()=>{stream.removeEventListener('addtrack',sync);stream.removeEventListener('removetrack',sync);for(const track of watched)for(const event of ['mute','unmute','ended'])track.removeEventListener(event,changed)};
 },[stream]);
 return hasVisibleVideo(stream)?<Media stream={stream!} muted volume={0}/>:<button type="button" className="voice-tile-avatar" title={`Профиль ${user.name}`} onClick={onOpen}><UserAvatar user={user} size="xl" decoration={user.decorations?.avatar}/></button>;
}
export function VoiceStage({voice:v,id,title,userName,me,meUser,users,onSettings,music}:{voice:Voice;id:string;title:string;userName:(id:string)=>string;me:string;meUser?:User;users?:User[];onSettings:()=>void;music?:ReturnType<typeof useRoomMusic>}){
 const joined=v.room===id;
 const actions=useUserActions();
 const microphoneOff=v.muted||v.deaf;
 const selfIdentity:User=meUser??{id:'',name:me,bio:'',created_at:0,online:true};
 const selfTile=<div className="voice-tile">{v.camera&&v.local?<Media stream={v.local} muted volume={0}/>:<button type="button" className="voice-tile-avatar" title="Открыть профиль" onClick={()=>meUser&&actions?.openProfile(meUser.id)}><UserAvatar user={selfIdentity} size="xl" decoration={selfIdentity.decorations?.avatar}/></button>}<span>{me} · Вы {v.muted||v.deaf?'· микрофон выключен':''}</span></div>;
 return <div className="voice-stage"><h1>{title}</h1><p>{joined?(v.peers.length?'Вы в голосовой комнате':'Вы в комнате. Пригласите друзей, чтобы начать общение.'):'Присоединитесь, чтобы общаться голосом и видео'}</p>
 {joined&&<div className="voice-grid">{meUser?<UserContextMenu user={meUser}>{selfTile}</UserContextMenu>:selfTile}{v.peers.map(p=>{
  const identity:User=users?.find(user=>user.id===p.user)??{id:p.user,name:userName(p.user),bio:'',created_at:0,online:true};
  const tile=<div className="voice-tile">{<VoicePeerVisual stream={v.streams[p.client]} user={identity} onOpen={()=>actions?.openProfile(identity.id)}/>}<span>{identity.name} · {v.connections[p.client]==='connected'?'На связи':v.connections[p.client]==='failed'?'Нет соединения — перезайдите':'Подключение…'}</span></div>;
  return <UserContextMenu key={p.client} user={identity}>{tile}</UserContextMenu>;
 })}</div>}
 {v.error&&<p className="voice-error" role="alert">{v.error}</p>}
 <div className="voice-controls">{joined?<><Button variant="secondary" title={microphoneOff?'Включить микрофон':'Выключить микрофон'} aria-label="Микрофон" aria-pressed={microphoneOff} onClick={v.toggleMic}>{microphoneOff?<MotionIcon icon={MicOff} kind="device"/>:<MotionIcon icon={Mic} kind="device"/>}</Button><Button variant="secondary" title={v.deaf?'Включить звук':'Отключить звук'} aria-label="Наушники" aria-pressed={v.deaf} onClick={v.toggleDeaf}>{v.deaf?<MotionIcon icon={HeadphoneOff} kind="device"/>:<MotionIcon icon={Headphones} kind="device"/>}</Button><Button variant="secondary" disabled={v.busy} title={v.camera?'Выключить камеру':'Включить камеру'} onClick={()=>void v.toggleCamera()}>{v.camera?<Video/>:<VideoOff/>}</Button><Button variant="secondary" className="voice-hangup" title="Отключиться" onClick={v.leave}><PhoneOff/></Button></>:<Button variant="secondary" disabled={v.busy} onClick={()=>void v.join(id)}>{v.busy?'Подключение…':'Присоединиться к голосовому каналу'}</Button>}<Button variant="secondary" title="Настройки голоса и видео" onClick={onSettings}><MotionIcon icon={Settings} kind="settings"/></Button></div>{music&&<RoomMusic key={id} music={music} joined={joined}/>}</div>
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
 useEffect(()=>{if(!preview?.getAudioTracks().length)return;const ctx=new AudioContext(),analyser=ctx.createAnalyser();ctx.createMediaStreamSource(preview).connect(analyser);const data=new Uint8Array(analyser.fftSize);const timer=setInterval(()=>{analyser.getByteTimeDomainData(data);setLevel(Math.min(100,Math.max(...data.map(x=>Math.abs(x-128)))*3))},100);return()=>{clearInterval(timer);void ctx.close()}},[preview]);
 async function test(video:boolean){stop();const token=epoch.current;setBusy(true);setError('');try{if(!navigator.mediaDevices)throw new Error('Устройства доступны через HTTPS или localhost.');const stream=await (video?navigator.mediaDevices.getUserMedia({audio:false,video:{deviceId:p.camera?{exact:p.camera}:undefined}}):captureVoiceStream(p,false));if(token!==epoch.current){stream.getTracks().forEach(stopCapturedTrack);return}owned.current=stream;setPreview(stream);await audioDevices.refresh()}catch(e){recordDesktopDiagnostic(video?'voice_camera':'voice_microphone',(e as DOMException).name==='NotAllowedError'?'device_permission':'device_error');setError(mediaError(e))}finally{setBusy(false)}}
 return <section className="voice-settings account-media-voice">
   <p>{v.room?'Устройства можно менять прямо во время звонка.':'Выберите устройства для звонков.'}</p>
   <AudioDeviceAccess devices={audioDevices} disabled={busy||v.busy}/>
   <section className="media-settings-panel" aria-label="Аудиоустройства">
    <div className="voice-device-fields">{renderDevice('audioinput',0)}{renderDevice('audiooutput',1)}<div className="voice-field voice-volume"><Label id="voice-volume-label">Громкость собеседников · {p.volume}%</Label><Slider aria-label="Громкость собеседников" min={0} max={100} value={[p.volume]} onValueChange={([volume])=>v.savePreferences('volume',volume)}/></div></div>
    <div className="voice-test-actions"><Button variant="secondary" disabled={busy||!!v.room} onClick={()=>void test(false)}>Проверить микрофон</Button><Progress aria-label="Уровень микрофона" value={level}/></div>
   </section>
   <section className="media-settings-panel"><h2>Обработка звука</h2><div className="voice-processing">
    <div className="voice-switch"><Label htmlFor="voice-echo">Эхоподавление</Label>
     <Switch id="voice-echo" disabled={v.busy} checked={p.echo} onCheckedChange={checked=>{stop();v.savePreferences('echo',checked)}}/>
    </div>
    <div className="voice-field"><Label htmlFor="voice-noise">Шумоподавление</Label>
     <Select id="voice-noise" label="Шумоподавление" value={p.noise} disabled={v.busy} options={noiseOptions}
      onValueChange={value=>{const option=noiseOptions.find(option=>option.value===value);if(option){stop();v.savePreferences('noise',option.value)}}}/>
    </div>
   </div></section>
   <section className="media-settings-panel"><h2>Камера</h2><div className="voice-device-fields">{renderDevice('videoinput',2)}<Button variant="secondary" disabled={busy||!!v.room} onClick={()=>void test(true)}>Проверить камеру</Button></div>
    {preview?.getVideoTracks().length? <Media stream={preview} muted volume={0}/>:null}
   </section>
   {preview&&<Button variant="secondary" onClick={stop}>Остановить проверку</Button>}
   <p>При проверке разрешите доступ к устройствам. Звук не передаётся другим участникам.</p>
   {(error||v.room&&v.error)&&<p role="alert">{error||v.error}</p>}
  </section>;
  function renderDevice(kind: MediaDeviceKind, i: number){
    const key=(['mic','speaker','camera'] as const)[i];
    const label=['Устройство ввода · микрофон','Устройство вывода · динамики','Камера'][i];
    const missing=isDeviceSelectionMissing(devices,audioDevices.loaded,kind,p[key]);
     const options=[{value:'',label:'По умолчанию'},...devices.filter(d=>d.kind===kind&&d.deviceId).map((d,n)=>({value:d.deviceId,label:d.label||`Устройство ${n+1}`}))];
    if(p[key]&&!options.some(option=>option.value===p[key]))options.push({value:p[key],label:missing?'Выбранное устройство (недоступно)':p[key]==='default'?'По умолчанию':p[key]==='communications'?'Устройство связи по умолчанию':'Выбранное устройство'});
    return <div className="voice-field" key={kind}><Label htmlFor={`voice-${key}`}>{label}</Label>
     <Select id={`voice-${key}`} label={label} value={p[key]} disabled={v.busy||audioDevices.requesting} onValueChange={value=>{stop();v.savePreferences(key,value)}} options={options}/>
      {missing&&<div className="audio-device-missing"><p role="status">Выбранное устройство недоступно. Настройка сохранена.</p><Button type="button" variant="secondary" size="sm" className="audio-device-reset" data-device-kind={kind} disabled={v.busy||audioDevices.requesting} onClick={()=>{stop();v.savePreferences(key,'')}}>Использовать по умолчанию · {['микрофон','динамики','камера'][i]}</Button></div>}
    </div>;
  }
}
