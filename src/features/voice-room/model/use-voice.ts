import {useEffect,useRef,useState} from 'react';
import {ApiConnectionError} from '@/shared/api/backend';
import {voiceService} from './services/voice-service';
import {desktopDiagnosticsAvailable,recordDesktopDiagnostic} from '@/shared/api/diagnostics';
import {createVoiceTransportMonitor,iceIsConnected} from './voice-diagnostics';
import {captureVoiceStream,readMedia,setCapturedTrackEnabled,stopCapturedTrack,type MediaPreferences} from './voice-input';
import {iceTransportPolicy,type IceServer} from './ice-policy';
export function mediaError(e:unknown){const name=(e as DOMException).name;return name==='NotAllowedError'?'Разрешите доступ к микрофону или камере в настройках приложения и Windows.':name==='NotFoundError'?'Устройство не найдено. Подключите микрофон или камеру.':name==='NotReadableError'?'Устройство занято другим приложением. Освободите его и повторите.':(e as Error).message||'Не удалось подключить устройство.'}
function videoConstraints(p:MediaPreferences){return {deviceId:p.camera?{exact:p.camera}:undefined,width:{ideal:1280},height:{ideal:720}}}
type VoiceAvailability={muted:boolean;deaf:boolean};
type Peer={client:string;user:string}&Partial<VoiceAvailability>;
type Poll={peers:Peer[];signals:{id:number;from:string;payload:{description?:RTCSessionDescriptionInit;candidate?:RTCIceCandidateInit}}[];cursor:number;iceServers:RTCIceServer[]};
type MicrophoneGain={context:AudioContext;source:MediaStreamAudioSourceNode;gain:GainNode;track:MediaStreamTrack};
type Call={room:string;client:string;stream:MediaStream;pcs:Map<string,RTCPeerConnection>;stop:boolean;microphone:MediaStreamTrack;micGain?:MicrophoneGain;members?:Set<string>;retries:Map<string,number>};
type TrackKind='audio'|'video';
const voiceCues={
 joined:new URL('../assets/voice-peer-joined.wav',import.meta.url).href,
 left:new URL('../assets/voice-left.wav',import.meta.url).href,
};

async function playVoiceCue(cue:keyof typeof voiceCues,speaker:string){
 const audio=new Audio();
 if(speaker&&speaker!=='default'&&audio.setSinkId){
  await audio.setSinkId(speaker).catch(()=>{}); // Use the system output if the selected device is unavailable.
 }
 audio.src=voiceCues[cue];
 await audio.play().catch(()=>{});
}

function otherMembers(peers:Peer[],client:string){
 const ownUser=peers.find(peer=>peer.client===client)?.user;
 return new Set(peers.filter(peer=>peer.client!==client&&peer.user!==ownUser).map(peer=>peer.user));
}

async function captureTrack(kind:TrackKind,preferences:MediaPreferences,shouldReport=()=>true){
 try{
  const stream=kind==='audio'?await captureVoiceStream(preferences):await navigator.mediaDevices.getUserMedia({video:videoConstraints(preferences)});
  const track=stream.getTracks().find(t=>t.kind===kind);
  if(track)return track;
  stream.getTracks().forEach(stopCapturedTrack);
  throw new DOMException('Устройство не найдено','NotFoundError');
 }catch(error){
  if(shouldReport())recordDesktopDiagnostic(kind==='audio'?'voice_microphone':'voice_camera',(error as DOMException).name==='NotAllowedError'?'device_permission':'device_error');
  throw error;
 }
}

async function replaceSenders(call:Call,kind:TrackKind,track:MediaStreamTrack|null){
 const results=await Promise.allSettled([...call.pcs.values()].map(async pc=>{
  const sender=pc.getTransceivers().find(t=>t.receiver.track.kind===kind)?.sender;
  if(!sender||pc.signalingState==='closed')return;
  try{await sender.replaceTrack(track)}
  catch(e){if(!call.stop&&pc.connectionState!=='closed')throw e}
 }));
 const failure=results.find(result=>result.status==='rejected');
 if(failure)throw failure.reason;
}
function microphoneSource(context:AudioContext,gain:GainNode,track:MediaStreamTrack){
 const source=context.createMediaStreamSource(new MediaStream([track]));
 source.connect(gain);
 return source;
}
function stopMicrophoneGain(graph:MicrophoneGain){
 graph.source.disconnect();
 graph.gain.disconnect();
 graph.track.stop();
 void graph.context.close();
}
export function useVoice(){
 const [room,setRoom]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[camera,setCamera]=useState(false),[local,setLocal]=useState<MediaStream|null>(null),[peers,setPeers]=useState<Peer[]>([]),[streams,setStreams]=useState<Record<string,MediaStream>>({}),[connections,setConnections]=useState<Record<string,string>>({}),[preferences,setPreferences]=useState(readMedia);
 const [availability,setAvailability]=useState<VoiceAvailability>({muted:false,deaf:false});
 const latestAvailability=useRef(availability);
  const availabilityRevision=useRef(0);
 const [micVolume,setMicVolumeValue]=useState(100);
 const preferredMicVolume=useRef(100);
 useEffect(()=>{if(room&&preferredMicVolume.current!==100)setMicVolume(preferredMicVolume.current)},[room]);
 const current=useRef<Call|null>(null),pending=useRef<symbol|null>(null),changingMedia=useRef(false),generation=useRef(0);
 const preferred=useRef(preferences);
 function leave(){
  generation.current++;
  pending.current=null;setBusy(false);
  const c=current.current;
  current.current=null;
  if(c){
   c.stop=true;
   c.stream.getTracks().filter(track=>track!==c.microphone&&track!==c.micGain?.track).forEach(stopCapturedTrack);
   stopCapturedTrack(c.microphone);
   if(c.micGain)stopMicrophoneGain(c.micGain);
   c.pcs.forEach(pc=>pc.close());
   void voiceService.leave({room:c.room,client:c.client}).catch(()=>{});
   if(c.members)void playVoiceCue('left',preferred.current.speaker);
  }
  setRoom('');setLocal(null);setPeers([]);setStreams({});setConnections({});setCamera(false);setMicVolumeValue(preferredMicVolume.current);
 }
 useEffect(()=>()=>{leave()},[]);
 async function join(destination:string,withVideo=false){if(pending.current||changingMedia.current)return false;leave();const operation=Symbol('voice-join');pending.current=operation;const epoch=generation.current;setBusy(true);setError('');let acquired:MediaStream|null=null;
  // Permission prompts may never settle. Bound our operation, and dispose of
  // any device track returned after timeout/cancellation without touching a newer call.
  const capture=(kind:TrackKind)=>new Promise<MediaStreamTrack>((resolve,reject)=>{
   let settled=false;
   const timer=setTimeout(()=>{
     settled=true;
     if(kind==='audio'&&epoch===generation.current)recordDesktopDiagnostic('voice_output','input_device_failed');
     reject(new Error('Истекло время ожидания доступа к устройству. Повторите подключение.'));
    },30000);
   void captureTrack(kind,preferred.current,()=>!settled&&epoch===generation.current).then(track=>{
    clearTimeout(timer);
    if(settled||epoch!==generation.current){stopCapturedTrack(track);if(!settled)reject(new Error('Подключение отменено.'));return}
    settled=true;resolve(track);
   },error=>{clearTimeout(timer);if(!settled){settled=true;reject(error)}});
  });
 try{
  if(!navigator.mediaDevices){
    recordDesktopDiagnostic('voice_output','input_device_failed');
    throw new Error('Для доступа к устройствам откройте приложение через HTTPS или localhost.');
   }
  acquired=new MediaStream([await capture('audio')]);
  if(withVideo)acquired.addTrack(await capture('video'));
  if(epoch!==generation.current){acquired.getTracks().forEach(stopCapturedTrack);return false}
  const c:Call={room:destination,client:crypto.randomUUID(),stream:acquired,pcs:new Map(),stop:false,microphone:acquired.getAudioTracks()[0],retries:new Map()};current.current=c;
  setCapturedTrackEnabled(c.microphone,!latestAvailability.current.muted&&!latestAvailability.current.deaf);
  const first=await voiceService.join<Poll>({room:c.room,client:c.client,...latestAvailability.current});if(c.stop){
   // Cancellation can race server admission; retire only this abandoned client.
   void voiceService.leave({room:c.room,client:c.client}).catch(()=>{});
   return false;
  }
  c.members=otherMembers(first.peers,c.client);
  setRoom(destination);setLocal(acquired);setCamera(withVideo);let cursor=0;
  let lastPoll=performance.now();
  const signal=(target:string,payload:unknown)=>voiceService.signal({room:c.room,client:c.client,target,payload});
  const diagnostics=desktopDiagnosticsAvailable();
  const samplers=new Map<string,(peer:Peer,time:number)=>void>();
  let nextSample=0, sampleOffset=0;
  let diagnosticPeers=new Map<string,Peer>();
  // Discord never sends media peer to peer: the voice server relays it. With TURN handed out by
  // voice_join we can do the same, which removes one-way audio on blocked direct paths.
  // The preference is read per connection, so a changed setting applies to the next peer.
  const mediaPolicy=()=>iceTransportPolicy(first.iceServers as IceServer[]|undefined,preferred.current.relay);
  const make=(id:string,initiator=false)=>{
   const pc=new RTCPeerConnection({iceServers:first.iceServers,...(mediaPolicy()==='relay'?{iceTransportPolicy:'relay' as RTCIceTransportPolicy}:{})});c.pcs.set(id,pc);
   if(initiator){pc.addTransceiver(c.stream.getAudioTracks()[0],{direction:'sendrecv'});
   pc.addTransceiver(c.stream.getVideoTracks()[0]||'video',{direction:'sendrecv'});}
   const remote=new MediaStream();
   pc.ontrack=e=>{
    if(c.stop||c.pcs.get(id)!==pc)return;
    // Replace the receiver kind without stopping tracks owned by WebRTC.
    // Keeping an older live audio track first would leave playback on stale input.
    for(const previous of remote.getTracks())if(previous.kind===e.track.kind&&previous!==e.track)remote.removeTrack(previous);
    remote.addTrack(e.track);setStreams(old=>({...old,[id]:remote}));
   };
   pc.onicecandidate=e=>{if(e.candidate&&!c.stop)void signal(id,{candidate:e.candidate.toJSON()}).catch(e=>setError(e.message))};
   pc.onconnectionstatechange=()=>{
    if(c.stop)return;
    setConnections(old=>({...old,[id]:pc.connectionState}));
    const state=pc.connectionState;
    if(state==='connected'){c.retries.delete(id);return}
    // Discord rebuilds the transport instead of asking the user to rejoin. Dropping the
    // connection is enough: the next poll offers again to this peer.
    if(state!=='failed'&&state!=='disconnected')return;
    const attempts=c.retries.get(id)??0;
    if(attempts>=6)return;
    c.retries.set(id,attempts+1);
    window.setTimeout(()=>{
     if(c.stop||c.pcs.get(id)!==pc)return;
     samplers.delete(id);
     pc.close();
     c.pcs.delete(id);
     setStreams(old=>{const next={...old};delete next[id];return next});
    },state==='failed'?600:3000);
   };
   if(diagnostics){
    const monitor=createVoiceTransportMonitor(category=>recordDesktopDiagnostic('voice_transport',category));
    const active=()=>!c.stop&&c.pcs.get(id)===pc&&pc.signalingState!=='closed';
    let revision=0, inFlight=false, availabilityAtSample=availabilityRevision.current;
    const expected=(peer:Peer)=>({
     send:!latestAvailability.current.muted&&!latestAvailability.current.deaf&&
      c.microphone.readyState==='live'&&!c.microphone.muted&&
      pc.getSenders().some(({track})=>track?.kind==='audio'&&track.enabled&&track.readyState==='live'),
     receive:!latestAvailability.current.deaf&&peer.muted===false&&peer.deaf===false&&
      remote.getAudioTracks().some(track=>track.readyState==='live'),
    });
    pc.oniceconnectionstatechange=()=>{if(active()){revision++;monitor.ice(pc.iceConnectionState);}};
    samplers.set(id,(peer,time)=>{
     if(!active()||!iceIsConnected(pc.iceConnectionState))return;
     if(availabilityAtSample!==availabilityRevision.current){
      monitor.reset();
      availabilityAtSample=availabilityRevision.current;
     }
     const before=expected(peer);
     if(!before.send)monitor.reset('send');
     if(!before.receive)monitor.reset('receive');
     if(inFlight)return;
     const sampledRevision=revision, sampledAvailability=availabilityRevision.current;
     inFlight=true;
     // Never wait for diagnostics in signaling; a hung read costs at most one slot per peer.
     void (async()=>{
      try{
       const stats=await pc.getStats();
       const latest=diagnosticPeers.get(id);
       if(!latest||!active()||revision!==sampledRevision||availabilityRevision.current!==sampledAvailability||!iceIsConnected(pc.iceConnectionState))return;
       if(performance.now()-time>5_000){monitor.reset();return;}
       const after=expected(latest);
       monitor.sample(stats,{receive:before.receive&&after.receive,send:before.send&&after.send},time);
      }catch{monitor.reset();}
      finally{inFlight=false;}
     })();
    });
   }
   return pc;
  };
  const candidates=new Map<string,RTCIceCandidateInit[]>();
  async function poll(){if(c.stop)return;try{
   let data:Poll;
   try {
    data=await voiceService.poll<Poll>({room:c.room,client:c.client,after:cursor,...latestAvailability.current});
   } catch (error) {
    if(error instanceof ApiConnectionError&&performance.now()-lastPoll<14000)return;
    throw error;
   }
   if(c.stop)return;
   lastPoll=performance.now();
   setPeers(data.peers.filter(p=>p.client!==c.client));
   const nextMembers=otherMembers(data.peers,c.client);
   const previousMembers=c.members;
   const someoneJoined=previousMembers&&[...nextMembers].some(user=>!previousMembers.has(user));
   const someoneLeft=previousMembers&&[...previousMembers].some(user=>!nextMembers.has(user));
   c.members=nextMembers;
   if(!latestAvailability.current.deaf){
    if(someoneLeft)void playVoiceCue('left',preferred.current.speaker);
    else if(someoneJoined)void playVoiceCue('joined',preferred.current.speaker);
   }
   for(const [id,pc] of c.pcs)if(!data.peers.some(p=>p.client===id)){samplers.delete(id);pc.close();c.pcs.delete(id);setStreams(old=>{const next={...old};delete next[id];return next})}
   if(diagnostics){
    diagnosticPeers=new Map(data.peers.map(peer=>[peer.client,peer]));
    if(lastPoll>=nextSample&&samplers.size){
     nextSample=lastPoll+5_000;
     // Bound stats work in large calls and give each peer a turn.
     const entries=[...samplers];
     for(let i=0;i<Math.min(4,entries.length);i++){
      const [id,sample]=entries[sampleOffset++%entries.length];
      const peer=diagnosticPeers.get(id);
      if(peer)sample(peer,lastPoll);
     }
     sampleOffset%=entries.length;
    }
   }
   for(const peer of data.peers)if(peer.client!==c.client&&!c.pcs.has(peer.client)&&c.client<peer.client){const pc=make(peer.client,true);await pc.setLocalDescription(await pc.createOffer());await signal(peer.client,{description:pc.localDescription})}
   for(const message of data.signals){const id=message.from;if(!data.peers.some(p=>p.client===id))continue;const pc=c.pcs.get(id)||make(id);const payload=message.payload;
    if(payload.description){await pc.setRemoteDescription(payload.description);for(const ice of candidates.get(id)||[])await pc.addIceCandidate(ice);candidates.delete(id);if(payload.description.type==='offer'){for(const t of pc.getTransceivers()){t.direction='sendrecv';await t.sender.replaceTrack(c.stream.getTracks().find(track=>track.kind===t.receiver.track.kind)||null)}await pc.setLocalDescription(await pc.createAnswer());await signal(id,{description:pc.localDescription})}}
    if(payload.candidate){if(pc.remoteDescription)await pc.addIceCandidate(payload.candidate);else candidates.set(id,[...(candidates.get(id)||[]),payload.candidate])}
   }
   cursor=data.cursor;
  }catch(e){if(!c.stop){leave();setError(mediaError(e))}}finally{
   // With no media peer yet the poll only discovers joins, so a slower tick is invisible
   // to the user; once a peer connection exists it carries signaling and stays at 700 ms.
   if(!c.stop)setTimeout(()=>void poll(),c.pcs.size?700:1000)
  }}
  void poll();
  return true;
 }catch(e){acquired?.getTracks().forEach(stopCapturedTrack);if(epoch===generation.current){leave();setError(mediaError(e))}return false}finally{if(pending.current===operation){pending.current=null;setBusy(false)}}}
 function updateAvailability(next:VoiceAvailability){
  availabilityRevision.current++;
  latestAvailability.current=next;
  setAvailability(next);
  const c=current.current;
  if(!c)return;
  const enabled=!next.muted&&!next.deaf;
  setCapturedTrackEnabled(c.microphone,enabled);
  c.stream.getAudioTracks().forEach(track=>{track.enabled=enabled});
 }
 function toggleMic(){
  const {muted,deaf}=latestAvailability.current;
  const next={muted:!muted&&!deaf,deaf:false};
  if(current.current&&!current.current.stop){
   if(muted!==next.muted)recordDesktopDiagnostic('voice_output',next.muted?'mic_muted':'mic_unmuted');
   if(deaf)recordDesktopDiagnostic('voice_output','output_undeafened');
  }
  updateAvailability(next);
 }
 function toggleDeaf(){
  const previous=latestAvailability.current;
  if(current.current&&!current.current.stop)recordDesktopDiagnostic('voice_output',previous.deaf?'output_undeafened':'output_deafened');
  updateAvailability({...previous,deaf:!previous.deaf});
 }
 async function replaceLocalTrack(c:Call,kind:TrackKind,track:MediaStreamTrack|null,{keepPrevious=false}={}){
  if(c.stop){if(track)stopCapturedTrack(track);return false}
  const previous=c.stream.getTracks().find(t=>t.kind===kind);
  if(track&&previous)setCapturedTrackEnabled(track,previous.enabled);
  if(previous)c.stream.removeTrack(previous);
  if(track)c.stream.addTrack(track);
  try{await replaceSenders(c,kind,track)}
  catch(error){
   if(!c.stop){
    if(track)c.stream.removeTrack(track);
    if(previous){
     if(track)setCapturedTrackEnabled(previous,track.enabled);
     c.stream.addTrack(previous);
    }
    await replaceSenders(c,kind,previous??null).catch(()=>{});
   }
   if(track)stopCapturedTrack(track);
   if(c.stop&&!keepPrevious&&previous)stopCapturedTrack(previous);
   throw error;
  }
  if(!keepPrevious&&previous)stopCapturedTrack(previous);
  if(c.stop){if(track)stopCapturedTrack(track);return false}
  setLocal(new MediaStream(c.stream.getTracks()));
  return true;
 }
 async function changeMedia(c:Call,action:()=>Promise<void>){
  if(pending.current||changingMedia.current)return;
  changingMedia.current=true;
  setBusy(true);setError('');
  try{await action()}catch(e){if(!c.stop)setError(mediaError(e))}
  finally{changingMedia.current=false;setBusy(false)}
 }
 async function toggleCamera(){
  const c=current.current;
  if(!c)return;
  await changeMedia(c,async()=>{
   const track=c.stream.getVideoTracks().length?null:await captureTrack('video',preferred.current);
   if(await replaceLocalTrack(c,'video',track))setCamera(!!track);
  });
 }
 function setMicVolume(value:number){
  value=Math.max(0,Math.min(200,value));
  preferredMicVolume.current=value;
  const c=current.current;
  if(!c){setMicVolumeValue(value);return}
  if(c.micGain){
   c.micGain.gain.gain.value=value/100;
   setMicVolumeValue(value);
   return;
  }
  if(value===100)return;
  void changeMedia(c,async()=>{
   const context=new AudioContext();
   let graph:MicrophoneGain|undefined;
   try{
    const gain=context.createGain(),output=context.createMediaStreamDestination();
    gain.gain.value=value/100;
    const source=microphoneSource(context,gain,c.microphone);
    gain.connect(output);
    graph={context,source,gain,track:output.stream.getAudioTracks()[0]};
    c.micGain=graph;
    setMicVolumeValue(value);
    await context.resume();
    if(!c.stop)await replaceLocalTrack(c,'audio',graph.track,{keepPrevious:true});
   }catch(error){
    if(!c.stop){
     c.micGain=undefined;
     if(graph)stopMicrophoneGain(graph);
     else void context.close();
     setMicVolumeValue(100);
    }
    throw error;
   }
  });
 }
 function savePreferences<K extends keyof MediaPreferences>(key:K,value:MediaPreferences[K]){
  if(preferred.current[key]===value)return;
  function save(){
   const next={...preferred.current,[key]:value};
   preferred.current=next;
   setPreferences(next);
   localStorage.setItem('mines-media',JSON.stringify(next));
  }
  const c=current.current;
  if(key==='volume'){save();return}
  if(pending.current||changingMedia.current)return;
  let kind:TrackKind|undefined;
  if(key==='mic'||key==='echo'||key==='noise')kind='audio';
  else if(key==='camera'&&c?.stream.getVideoTracks().length)kind='video';
  if(!c||!kind){save();return}
  const trackKind=kind;
  void changeMedia(c,async()=>{
   const track=await captureTrack(trackKind,{...preferred.current,[key]:value});
   if(trackKind==='audio'&&c.micGain){
    if(c.stop){stopCapturedTrack(track);return}
    const graph=c.micGain;
    try{
     setCapturedTrackEnabled(track,graph.track.enabled);
     const source=microphoneSource(graph.context,graph.gain,track);
     graph.source.disconnect();
     graph.source=source;
    }catch(error){stopCapturedTrack(track);throw error}
    stopCapturedTrack(c.microphone);
    c.microphone=track;
    save();
   }else if(await replaceLocalTrack(c,trackKind,track)){
    if(trackKind==='audio')c.microphone=track;
    save();
   }
  });
 }
 return {room,busy,error,...availability,camera,local,peers,streams,connections,preferences,savePreferences,join,leave,toggleMic,toggleDeaf,toggleCamera,micVolume,setMicVolume};
}
export type Voice=ReturnType<typeof useVoice>;

