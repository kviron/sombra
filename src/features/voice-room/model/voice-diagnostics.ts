import type {VoiceTransportCategory} from '@/shared/api/diagnostics';

type Emit = (category: VoiceTransportCategory) => void;
type Direction = 'receive' | 'send';
type Expected = Record<Direction, boolean>;
type Reading = {
 packets: Map<string, number>;
 time: number;
 moving: boolean;
 flat: number;
 stalled: boolean;
};
const iceCategories: Partial<Record<RTCIceConnectionState, VoiceTransportCategory>> = {
 checking: 'ice_checking',
 connected: 'ice_connected',
 completed: 'ice_connected',
 disconnected: 'ice_disconnected',
 failed: 'ice_failed'
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
  if (direction) delete readings[direction];
  else {
   delete readings.receive;
   delete readings.send;
  }
 }

 function flow(direction: Direction, packets: Map<string, number>, time: number) {
  if (!packets.size) {
   reset(direction);
   return;
  }
  const before = readings[direction];
  if (
   !before ||
   time - before.time > 60_000 ||
   before.packets.size !== packets.size ||
   [...packets].some(([id, count]) => !before.packets.has(id) || count < before.packets.get(id)!)
  ) {
   readings[direction] = {packets, time, moving: false, flat: 0, stalled: false};
   return;
  }
  const advancing = [...packets].some(([id, count]) => count > before.packets.get(id)!);
  before.packets = packets;
  before.time = time;
  if (advancing) {
   before.moving = true;
   before.flat = 0;
   if (before.stalled) {
    before.stalled = false;
    emit(direction === 'receive' ? 'audio_receive_recovered' : 'audio_send_recovered');
   }
  } else if (before.moving && !before.stalled && ++before.flat >= 3) {
   // A heuristic about RTP delivery, not a measurement of speech or audibility.
   before.stalled = true;
   emit(direction === 'receive' ? 'audio_receive_stalled' : 'audio_send_stalled');
  }
 }

 return {
  reset,
  ice(state: RTCIceConnectionState) {
   if (!iceIsConnected(state)) {
    reset();
    path = undefined;
   }
   const category = iceCategories[state];
   if (category && category !== ice) emit(category);
   ice = category;
  },
  sample(stats: RTCStatsReport, expected: Expected, time: number) {
   const packets = {receive: new Map<string, number>(), send: new Map<string, number>()};
   const audioTransports = new Set<string>(),
    anyTransports = new Set<string>();
   stats.forEach(stat => {
    if (stat.type === 'transport') anyTransports.add(stat.id);
    if ((stat.type !== 'inbound-rtp' && stat.type !== 'outbound-rtp') || (stat.kind ?? stat.mediaType) !== 'audio')
     return;
    if (typeof stat.transportId === 'string') audioTransports.add(stat.transportId);
    const direction = stat.type === 'inbound-rtp' ? 'receive' : 'send';
    const count = direction === 'receive' ? stat.packetsReceived : stat.packetsSent;
    if (Number.isSafeInteger(count) && count >= 0) packets[direction].set(stat.id, count);
   });
   // Use only the selected pair for the audio transport (or a single bundled transport).
   const transports = audioTransports.size ? audioTransports : anyTransports;
   if (transports.size === 1) {
    const transport = stats.get([...transports][0]);
    const pair = transport?.type === 'transport' ? stats.get(transport.selectedCandidatePairId) : undefined;
    const local =
     pair?.type === 'candidate-pair' && pair.state === 'succeeded' ? stats.get(pair.localCandidateId) : undefined;
    const remote =
     pair?.type === 'candidate-pair' && pair.state === 'succeeded' ? stats.get(pair.remoteCandidateId) : undefined;
    if (local?.type === 'local-candidate' && remote?.type === 'remote-candidate') {
     const a = local.candidateType,
      b = remote.candidateType;
     const category =
      a === 'relay' || b === 'relay'
       ? 'path_relay'
       : directTypes.has(a) && directTypes.has(b)
         ? 'path_direct'
         : undefined;
     if (category && category !== path) {
      path = category;
      emit(category);
     }
    }
   }
   for (const direction of ['receive', 'send'] as const) {
    if (expected[direction]) flow(direction, packets[direction], time);
    else reset(direction);
   }
  }
 };
}
