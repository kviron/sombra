import type {VoiceTransportCategory} from '@/shared/api/diagnostics';

type Emit = (category: VoiceTransportCategory) => void;
type Direction = 'receive' | 'send';
type Expected = Record<Direction, boolean>;
type Reading = {packets: Map<string, number>; time: number; moving: boolean; flat: number; stalled: boolean; silent: number; quiet: boolean; energy?: number};
// Outbound audio below this level for three samples is treated as capture silence, not loss.
const SILENCE = 0.004;
const SPEECH = 0.01;
// Chromium may omit audioLevel but still reports cumulative energy; its flatness means the
// microphone contributed nothing between samples.
const ENERGY_EPSILON = 1e-7;
const iceCategories: Partial<Record<RTCIceConnectionState, VoiceTransportCategory>> = {
 checking: 'ice_checking', connected: 'ice_connected', completed: 'ice_connected',
 disconnected: 'ice_disconnected', failed: 'ice_failed',
};
const directTypes = new Set(['host', 'srflx', 'prflx']);

export function iceIsConnected(state: RTCIceConnectionState) {
 return state === 'connected' || state === 'completed';
}

export function createVoiceTransportMonitor(emit: Emit) {
 let ice: VoiceTransportCategory | undefined;
 let path: 'path_direct' | 'path_relay' | undefined;
 const readings: Partial<Record<Direction, Reading>> = {};

 function reset(direction?: Direction) {
  if(direction)delete readings[direction];
  else {delete readings.receive;delete readings.send;}
 }

 function flow(direction: Direction, packets: Map<string, number>, time: number, level?: number, energy?: number) {
  if(!packets.size){reset(direction);return;}
  const before=readings[direction];
  if(!before||time-before.time>60_000||before.packets.size!==packets.size||
     [...packets].some(([id,count])=>!before.packets.has(id)||count<before.packets.get(id)!)) {
   readings[direction]={packets,time,moving:false,flat:0,stalled:false,silent:0,quiet:false,energy};
   return;
  }
  const advancing=[...packets].some(([id,count])=>count>before.packets.get(id)!);
  const previousEnergy=before.energy;
  before.packets=packets;
  before.time=time;
  if(advancing){
   before.moving=true;
   before.flat=0;
   if(before.stalled){before.stalled=false;emit(direction==='receive'?'audio_receive_recovered':'audio_send_recovered');}
  }else if(before.moving&&!before.stalled&&++before.flat>=3){
   // A heuristic about RTP delivery, not a measurement of speech or audibility.
   before.stalled=true;
   emit(direction==='receive'?'audio_receive_stalled':'audio_send_stalled');
  }
  if(direction!=='send')return;
  // Silence fills the gap the packet heuristic leaves: packets flow while the
  // microphone contributes nothing. It is not proof of what a peer hears.
  // audioLevel is preferred; cumulative energy is the fallback when the engine omits it.
  let quiet: boolean | undefined;
  if(level!==undefined)quiet=level<SPEECH;
  else if(previousEnergy!==undefined&&energy!==undefined)quiet=energy-previousEnergy<ENERGY_EPSILON;
  before.energy=energy;
  if(quiet===undefined)return;
  if(quiet){
   if(advancing&&++before.silent>=3&&!before.quiet){before.quiet=true;emit('audio_send_silent');}
  }else{
   before.silent=0;
   if(before.quiet){before.quiet=false;emit('audio_send_silent_recovered');}
  }
 }

 return {
  reset,
  ice(state: RTCIceConnectionState) {
   if(!iceIsConnected(state)){reset();path=undefined;}
   const category=iceCategories[state];
   if(category&&category!==ice)emit(category);
   ice=category;
  },
  sample(stats: RTCStatsReport, expected: Expected, time: number) {
   const packets={receive:new Map<string,number>(),send:new Map<string,number>()};
   const audioTransports=new Set<string>(), anyTransports=new Set<string>();
   let sendLevel:number|undefined;
   let sendEnergy:number|undefined;
   stats.forEach(stat=>{
    if(stat.type==='transport')anyTransports.add(stat.id);
    if((stat.type!=='inbound-rtp'&&stat.type!=='outbound-rtp')||(stat.kind??stat.mediaType)!=='audio')return;
    if(typeof stat.transportId==='string')audioTransports.add(stat.transportId);
    const direction=stat.type==='inbound-rtp'?'receive':'send';
    const count=direction==='receive'?stat.packetsReceived:stat.packetsSent;
    if(Number.isSafeInteger(count)&&count>=0)packets[direction].set(stat.id,count);
    // Chromium reports outbound audioLevel; other engines may omit it, so it stays optional.
    if(direction==='send'&&typeof stat.audioLevel==='number'&&Number.isFinite(stat.audioLevel))
     sendLevel=Math.max(sendLevel??0,stat.audioLevel);
    // Cumulative energy is present even when audioLevel is not; the monitor compares samples.
    if(direction==='send'&&typeof stat.totalAudioEnergy==='number'&&Number.isFinite(stat.totalAudioEnergy))
     sendEnergy=Math.max(sendEnergy??0,stat.totalAudioEnergy);
   });
   // Use only the selected pair for the audio transport (or a single bundled transport).
   const transports=audioTransports.size?audioTransports:anyTransports;
   if(transports.size===1){
    const transport=stats.get([...transports][0]);
    const pair=transport?.type==='transport'?stats.get(transport.selectedCandidatePairId):undefined;
    const local=pair?.type==='candidate-pair'&&pair.state==='succeeded'?stats.get(pair.localCandidateId):undefined;
    const remote=pair?.type==='candidate-pair'&&pair.state==='succeeded'?stats.get(pair.remoteCandidateId):undefined;
    if(local?.type==='local-candidate'&&remote?.type==='remote-candidate'){
     const a=local.candidateType,b=remote.candidateType;
     const category=a==='relay'||b==='relay'?'path_relay':directTypes.has(a)&&directTypes.has(b)?'path_direct':undefined;
     if(category&&category!==path){path=category;emit(category);}
    }
   }
   for(const direction of ['receive','send'] as const){
    if(expected[direction])flow(direction,packets[direction],time,direction==='send'?sendLevel:undefined,direction==='send'?sendEnergy:undefined);
    else reset(direction);
   }
  },
 };
}
