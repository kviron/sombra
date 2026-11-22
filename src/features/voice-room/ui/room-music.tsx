import {useEffect,useId,useRef,useState} from 'react';
import {ListMusic,Music2,Pause,Play,Plus,SkipForward,Square,Volume2} from 'lucide-react';
import {api} from '@/shared/api/backend';
import {parseMusicCommand,parseMusicLimit} from '@/shared/lib/music-command';
import {defaultGenerativeUILibrary,renderGenerativeUI} from '@assistant-ui/generative-ui/react';
import './room-music-elements.css';
import './room-music.css';

import {openRoomMusicStream} from '../model/room-music-stream';

type Track={id:string;title:string;url?:string;assetId?:string;stream?:boolean;durationMs:number};
const MAX_PRIVATE_AUDIO=10*1024*1024;
type Snapshot={room:string;revision:number;serverTimeMs:number;positionMs:number;status:'idle'|'playing'|'paused';track:Track|null;queue:Track[]};
type Action='add'|'pause'|'resume'|'skip'|'stop';
type Reading={state:Snapshot;received:number};
const position=({state,received}:Reading)=>Math.max(0,Math.min(state.track?.durationMs??0,state.positionMs+(state.status==='playing'?performance.now()-received:0)));
function message(error:unknown){
 const raw=String(error);
 if(raw.includes('MUSIC_PROVIDER_NOT_CONFIGURED'))return 'Яндекс Музыка пока не подключена на сервере.';
 if(raw.includes('MUSIC_SOURCE_NOT_APPROVED'))return 'Эта ссылка не входит в разрешённый каталог комнаты.';
 return 'Не удалось выполнить команду музыки. Проверьте подключение к комнате.';
}
export function useRoomMusic(room:string|undefined,deaf:boolean,speaker:string){
 const [reading,setReading]=useState<Reading|null>(null),[volume,setVolume]=useState(65),[blocked,setBlocked]=useState(false),[unavailable,setUnavailable]=useState(false);
 const engine=useRef<HTMLAudioElement>(null), epoch=useRef(0), lastTrack=useRef<string|undefined>(undefined);
 const current=room&&reading?.state.room===room?reading:null;
 const track=current?.state.track??null;
 const assetId=track?.assetId,trackId=track?.id;
 const [privateAudio,setPrivateAudio]=useState<{room:string;trackId:string;url:string}>();
 const [privateFailure,setPrivateFailure]=useState(''),[retry,setRetry]=useState(0);
 const playbackUrl=assetId?(privateAudio?.room===room&&privateAudio?.trackId===trackId?privateAudio?.url:undefined):track?.url;
 useEffect(()=>{
  setPrivateAudio(undefined);setPrivateFailure('');
  if(!room||!assetId||!trackId)return;
  if(track?.stream){
   if(!engine.current)return;
   try{const stream=openRoomMusicStream(room,assetId,track.durationMs,engine.current,()=>setPrivateFailure('Не удалось продолжить поток Яндекс Музыки.'));setPrivateAudio({room,trackId,url:stream.url});return stream.close}
   catch{setPrivateFailure('Этот клиент не поддерживает потоковое воспроизведение MP3.');return}
  }
  let disposed=false,objectUrl:string|undefined;
  void api<{mime:string;base64:string}>('music_file',{room,id:assetId}).then(file=>{
   if(disposed)return;
   if(file.mime!=='audio/mpeg'||typeof file.base64!=='string'||!file.base64||file.base64.length>4*Math.ceil(MAX_PRIVATE_AUDIO/3))throw new Error('Invalid media');
   const raw=atob(file.base64);if(raw.length>MAX_PRIVATE_AUDIO)throw new Error('Media too large');
   objectUrl=URL.createObjectURL(new Blob([Uint8Array.from(raw,c=>c.charCodeAt(0))],{type:file.mime}));
   setPrivateAudio({room,trackId,url:objectUrl});
  }).catch(()=>{if(!disposed)setPrivateFailure('Не удалось загрузить аудио этой комнаты.')});
  return()=>{disposed=true;if(objectUrl)URL.revokeObjectURL(objectUrl)};
 },[room,assetId,trackId,track?.stream,track?.durationMs,retry]);
 function accept(state:Snapshot,started:number){
  const received=performance.now()-(performance.now()-started)/2;
  setReading(previous=>previous&&previous.state.room===state.room&&previous.state.serverTimeMs>state.serverTimeMs?previous:{state,received});
 }
 useEffect(()=>{
  const generation=++epoch.current;
  setReading(null);setUnavailable(false);setBlocked(false);
  if(!room)return;
  let pending=false;
  async function poll(){
   if(pending)return;
   pending=true;const started=performance.now();
   try{const state=await api<Snapshot>('music_state',{room});if(epoch.current===generation){accept(state,started);setUnavailable(false)}}
   catch{if(epoch.current===generation){setUnavailable(true);setReading(null)}}
   finally{pending=false}
  }
  void poll();const timer=window.setInterval(poll,2000);
  return()=>{epoch.current++;clearInterval(timer)};
 },[room]);
 async function command(action:Action,url?:string,limit?:number){
   if(limit!==undefined&&(!Number.isInteger(limit)||limit<1||limit>1000))throw new Error('Укажите число треков от 1 до 1000.');
  if(!room)throw new Error('Сначала войдите в голосовую комнату.');
  if(action==='add'&&!url)throw new Error('Укажите ссылку после /play.');
  if(action!=='add'&&url)throw new Error('Эта команда не принимает ссылку.');
  const generation=epoch.current,started=performance.now();
  try{const state=await api<Snapshot>('music_command',{room,action,...(url?{url}:{}),...(limit!==undefined?{limit}:{})});if(epoch.current===generation)accept(state,started)}
  catch(error){throw new Error(message(error))}
 }
 useEffect(()=>{const el=engine.current;if(el){el.volume=volume/100;el.muted=deaf}},[volume,deaf]);
 useEffect(()=>{const el=engine.current;if(el?.setSinkId)void el.setSinkId(speaker).catch(()=>{})},[speaker]);
 useEffect(()=>{
  const el=engine.current;if(!el)return;
  let active=true;
  const sync=()=>{
   if(!current?.state.track||!playbackUrl){el.pause();lastTrack.current=undefined;return}
   const target=position(current)/1000;
   if(el.readyState>=1){
    const changed=lastTrack.current!==current.state.track.id;
    lastTrack.current=current.state.track.id;
    if(changed||Math.abs(el.currentTime-target)>(el.paused ? .2 : 1.25))el.currentTime=target;
   }
   if(current.state.status==='playing'&&el.paused)void el.play().then(()=>{if(active)setBlocked(false)},()=>{if(active)setBlocked(true)});
   else if(current.state.status!=='playing'){el.pause();setBlocked(false)}
  };
  sync();el.addEventListener('loadedmetadata',sync);
  return()=>{active=false;el.removeEventListener('loadedmetadata',sync)};
 },[current,playbackUrl]);
 const enableAudio=()=>void engine.current?.play().then(()=>setBlocked(false),()=>setBlocked(true));
 return {current,unavailable,volume,setVolume,blocked,enableAudio,command,privateFailure,retryAudio:()=>setRetry(value=>value+1),loadingPrivate:!!assetId&&!playbackUrl&&!privateFailure,audio:<audio ref={engine} src={playbackUrl} preload="metadata" onError={()=>{if(playbackUrl)setBlocked(true)}}/>};
}
const time=(ms:number)=>{const seconds=Math.floor(ms/1000);return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`};
export function RoomMusic({music,joined}:{music:ReturnType<typeof useRoomMusic>;joined:boolean}){
 const [link,setLink]=useState(''),[error,setError]=useState(''),[pending,setPending]=useState(false),[expanded,setExpanded]=useState(false),[,tick]=useState(0);
 const queueId=useId(),linkId=useId();
 const state=joined?music.current?.state:null,track=state?.track,playing=state?.status==='playing',queue=state?.queue??[];
 const elapsed=joined&&music.current?position(music.current):0;
 useEffect(()=>{if(!playing)return;const timer=setInterval(()=>tick(value=>value+1),500);return()=>clearInterval(timer)},[playing]);
 const [limit,setLimit]=useState('32'),[pageSize,setPageSize]=useState(40);
 async function act(action:Action,url?:string,requested?:number){
  if(pending)return;setPending(true);setError('');
  try{await music.command(action,url,requested);if(action==='add')setLink('')}
  catch(e){setError((e as Error).message)}finally{setPending(false)}
 }
 return <section className="room-music" data-aui-theme="elements" data-aui="card" data-aui-surface="true" aria-label="Музыка в комнате">
  <header className="room-music-header"><span><Music2 size={16}/> Музыка в комнате</span><button data-aui="button" data-aui-style="ghost" type="button" aria-expanded={expanded} aria-controls={queueId} onClick={()=>setExpanded(!expanded)}><ListMusic size={16}/> Очередь <span>{queue.length}</span></button></header>
  <div className="room-music-track"><span className="room-music-art"><Music2 size={23}/></span><div><strong>{track?.title??'Сейчас ничего не играет'}</strong><small>{joined?(music.unavailable?'Музыка недоступна на этом сервере':track?(playing?'Сейчас играет':'На паузе'):'Добавьте трек в общую очередь'):'Войдите в комнату, чтобы включить музыку'}</small></div></div>
  {track&&<><div className="room-music-progress"><span>{time(elapsed)}</span><progress aria-label="Позиция воспроизведения" value={elapsed} max={Math.max(1,track.durationMs)}/><span>{time(track.durationMs)}</span></div><div className="room-music-actions"><button data-aui="button" data-aui-style="primary" type="button" title={playing?'Пауза':'Продолжить'} aria-label={playing?'Пауза':'Продолжить'} disabled={pending} onClick={()=>void act(playing?'pause':'resume')}>{playing?<Pause size={18}/>:<Play size={18}/>}</button><button data-aui="button" data-aui-style="ghost" type="button" title="Следующий трек" aria-label="Следующий трек" disabled={pending} onClick={()=>void act('skip')}><SkipForward size={18}/></button><button data-aui="button" data-aui-style="ghost" type="button" title="Остановить и очистить очередь" aria-label="Остановить и очистить очередь" disabled={pending} onClick={()=>void act('stop')}><Square size={16}/></button><label><Volume2 size={16}/><input data-aui="slider" aria-label="Громкость музыки для вас" type="range" min="0" max="100" value={music.volume} onChange={e=>music.setVolume(+e.target.value)}/></label></div></>}
  {music.loadingPrivate&&<small role="status">Загружаем аудио комнаты…</small>}
   {music.privateFailure&&<div role="alert" className="room-music-error">{music.privateFailure} <button type="button" data-aui="button" data-aui-style="ghost" onClick={music.retryAudio}>Повторить</button></div>}
   {track&&music.blocked&&playing&&!music.loadingPrivate&&!music.privateFailure&&<button data-aui="button" data-aui-style="ghost" type="button" onClick={music.enableAudio}>Включить звук на этом устройстве</button>}
  <div id={queueId} hidden={!expanded}>{queue.length?<div className="room-music-queue">{renderGenerativeUI({$type:"ListView",children:queue.slice(0,pageSize).map((item,i)=>({$type:"ListViewItem",$key:item.id,children:{$type:"Row",align:"center",gap:3,children:[{$type:"Text",value:String(i+1),size:"sm",color:"secondary"},{$type:"Text",value:item.title,weight:"medium"},{$type:"Spacer"},{$type:"Caption",text:time(item.durationMs)}]}}))},defaultGenerativeUILibrary,{status:"done"})}{queue.length>pageSize&&<button type="button" data-aui="button" data-aui-style="ghost" onClick={()=>setPageSize(n=>n+40)}>Показать ещё</button>}</div>:<p className="room-music-empty">В очереди пока нет треков.</p>}</div>
  <form className="room-music-add" onSubmit={e=>{e.preventDefault();if(joined&&!music.unavailable&&!pending&&link.trim())void act('add',link.trim(),parseMusicLimit(limit))}}><label className="room-music-link">Ссылка<input data-aui="input" id={linkId} aria-label="Ссылка на трек или плейлист" placeholder="Трек или плейлист" value={link} maxLength={2048} onChange={e=>setLink(e.target.value)} disabled={pending}/></label><label className="room-music-limit">Треков<input data-aui="input" type="number" min={1} max={1000} required value={limit} onChange={e=>setLimit(e.target.value)} disabled={pending}/></label><button data-aui="button" data-aui-style="secondary" type="submit" disabled={!joined||music.unavailable||pending||!link.trim()}><Plus size={16}/> Добавить</button></form>
  {error&&<p role="alert" className="room-music-error">{error}</p>}
 </section>;
}
