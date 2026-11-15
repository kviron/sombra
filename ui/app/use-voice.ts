import {useEffect,useRef,useState} from 'react';
import {api} from '@/shared/api/backend';
export type MediaPreferences={mic:string;camera:string;speaker:string;volume:number;echo:boolean;noise:boolean};
export const defaultMedia:MediaPreferences={mic:'',camera:'',speaker:'',volume:100,echo:true,noise:true};
export function readMedia():MediaPreferences{try{return {...defaultMedia,...JSON.parse(localStorage.getItem('mines-media')||'{}')}}catch{return defaultMedia}}
export function mediaError(e:unknown){const name=(e as DOMException).name;return name==='NotAllowedError'?'Разрешите доступ к микрофону или камере в настройках приложения и Windows.':name==='NotFoundError'?'Устройство не найдено. Подключите микрофон или камеру.':name==='NotReadableError'?'Устройство занято другим приложением. Освободите его и повторите.':(e as Error).message||'Не удалось подключить устройство.'}
export function audioConstraints(p:MediaPreferences){return {deviceId:p.mic?{exact:p.mic}:undefined,echoCancellation:p.echo,noiseSuppression:p.noise}}
type Peer={client:string;user:string};
type Poll={peers:Peer[];signals:{id:number;from:string;payload:{description?:RTCSessionDescriptionInit;candidate?:RTCIceCandidateInit}}[];cursor:number;iceServers:RTCIceServer[]};
export function useVoice(){
 const [room,setRoom]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[muted,setMuted]=useState(false),[deaf,setDeaf]=useState(false),[camera,setCamera]=useState(false),[local,setLocal]=useState<MediaStream|null>(null),[peers,setPeers]=useState<Peer[]>([]),[streams,setStreams]=useState<Record<string,MediaStream>>({}),[connections,setConnections]=useState<Record<string,string>>({}),[preferences,setPreferences]=useState(readMedia);
 const current=useRef<{room:string;client:string;stream:MediaStream;pcs:Map<string,RTCPeerConnection>;stop:boolean}|null>(null),pending=useRef(false),generation=useRef(0);
 function leave(){generation.current++;const c=current.current;current.current=null;if(c){c.stop=true;c.stream.getTracks().forEach(t=>t.stop());c.pcs.forEach(pc=>pc.close());void api('voice_leave',{room:c.room,client:c.client}).catch(()=>{})}setRoom('');setLocal(null);setPeers([]);setStreams({});setConnections({});setCamera(false);setMuted(false);setDeaf(false)}
 useEffect(()=>()=>{leave()},[]);
 async function join(destination:string){if(pending.current)return;pending.current=true;leave();const epoch=generation.current;setBusy(true);setError('');let acquired:MediaStream|null=null;
 try{
  if(!navigator.mediaDevices)throw new Error('Для доступа к устройствам откройте приложение через HTTPS или localhost.');
  acquired=await navigator.mediaDevices.getUserMedia({audio:audioConstraints(preferences)});
  if(epoch!==generation.current){acquired.getTracks().forEach(t=>t.stop());return}
  const c={room:destination,client:crypto.randomUUID(),stream:acquired,pcs:new Map<string,RTCPeerConnection>(),stop:false};current.current=c;
  const request=(op:string,data={})=>api<Poll>(op,{room:c.room,client:c.client,...data});
  const first=await request('voice_join');if(c.stop)return;
  setRoom(destination);setLocal(acquired);let cursor=0;
  const signal=(target:string,payload:unknown)=>request('voice_signal',{target,payload});
  const make=(id:string,initiator=false)=>{
   const pc=new RTCPeerConnection({iceServers:first.iceServers});c.pcs.set(id,pc);
   if(initiator){pc.addTransceiver(c.stream.getAudioTracks()[0],{direction:'sendrecv'});
   pc.addTransceiver(c.stream.getVideoTracks()[0]||'video',{direction:'sendrecv'});}
   const remote=new MediaStream();
   pc.ontrack=e=>{remote.addTrack(e.track);setStreams(old=>({...old,[id]:remote}))};
   pc.onicecandidate=e=>{if(e.candidate&&!c.stop)void signal(id,{candidate:e.candidate.toJSON()}).catch(e=>setError(e.message))};
   pc.onconnectionstatechange=()=>{if(!c.stop)setConnections(old=>({...old,[id]:pc.connectionState}))};
   return pc;
  };
  const candidates=new Map<string,RTCIceCandidateInit[]>();
  async function poll(){if(c.stop)return;try{
   const data=await request('voice_poll',{after:cursor});if(c.stop)return;setPeers(data.peers.filter(p=>p.client!==c.client));
   for(const [id,pc] of c.pcs)if(!data.peers.some(p=>p.client===id)){pc.close();c.pcs.delete(id);setStreams(old=>{const next={...old};delete next[id];return next})}
   for(const peer of data.peers)if(peer.client!==c.client&&!c.pcs.has(peer.client)&&c.client<peer.client){const pc=make(peer.client,true);await pc.setLocalDescription(await pc.createOffer());await signal(peer.client,{description:pc.localDescription})}
   for(const message of data.signals){const id=message.from;if(!data.peers.some(p=>p.client===id))continue;const pc=c.pcs.get(id)||make(id);const payload=message.payload;
    if(payload.description){await pc.setRemoteDescription(payload.description);for(const ice of candidates.get(id)||[])await pc.addIceCandidate(ice);candidates.delete(id);if(payload.description.type==='offer'){for(const t of pc.getTransceivers()){t.direction='sendrecv';await t.sender.replaceTrack(c.stream.getTracks().find(track=>track.kind===t.receiver.track.kind)||null)}await pc.setLocalDescription(await pc.createAnswer());await signal(id,{description:pc.localDescription})}}
    if(payload.candidate){if(pc.remoteDescription)await pc.addIceCandidate(payload.candidate);else candidates.set(id,[...(candidates.get(id)||[]),payload.candidate])}
   }
   cursor=data.cursor;
  }catch(e){if(!c.stop){leave();setError(mediaError(e))}}finally{if(!c.stop)setTimeout(()=>void poll(),700)}}
  void poll();
 }catch(e){acquired?.getTracks().forEach(t=>t.stop());leave();setError(mediaError(e))}finally{pending.current=false;setBusy(false)}}
 function toggleMic(){const next=!muted;setMuted(next);current.current?.stream.getAudioTracks().forEach(t=>t.enabled=!next&&!deaf)}
 function toggleDeaf(){const next=!deaf;setDeaf(next);current.current?.stream.getAudioTracks().forEach(t=>t.enabled=!next&&!muted)}
 async function toggleCamera(){const c=current.current;if(!c||busy)return;setBusy(true);setError('');try{
  const old=c.stream.getVideoTracks()[0];const track=old?null:(await navigator.mediaDevices.getUserMedia({video:{deviceId:preferences.camera?{exact:preferences.camera}:undefined,width:{ideal:1280},height:{ideal:720}}})).getVideoTracks()[0];
  if(c.stop){track?.stop();return}
  try{await Promise.all([...c.pcs.values()].map(pc=>pc.getTransceivers().find(t=>t.receiver.track.kind==='video')?.sender.replaceTrack(track)))}catch(e){track?.stop();throw e}
  if(old){old.stop();c.stream.removeTrack(old)}if(track)c.stream.addTrack(track);setLocal(new MediaStream(c.stream.getTracks()));setCamera(!!track);
 }catch(e){setError(mediaError(e))}finally{setBusy(false)}}
 function savePreferences(next:MediaPreferences){setPreferences(next);localStorage.setItem('mines-media',JSON.stringify(next))}
 return {room,busy,error,muted,deaf,camera,local,peers,streams,connections,preferences,savePreferences,join,leave,toggleMic,toggleDeaf,toggleCamera};
}
export type Voice=ReturnType<typeof useVoice>;

