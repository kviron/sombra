import {desktopDiagnosticsAvailable, recordDesktopDiagnostic} from '@/shared/api/diagnostics';
import type {VoiceAvailability, VoicePeer as Peer} from '@/shared/types';
import {createVoiceTransportMonitor, iceIsConnected} from './voice-diagnostics';
import type {Call} from './voice-call';
export function createVoiceSampling(
 c: Call,
 availability: () => VoiceAvailability,
 availabilityRevision: () => number
) {
 const diagnostics = desktopDiagnosticsAvailable();
 const samplers = new Map<string, (peer: Peer, time: number) => void>();
 let nextSample = 0,
  sampleOffset = 0;
 let diagnosticPeers = new Map<string, Peer>();

 return {
  watch(id: string, pc: RTCPeerConnection, remote: MediaStream) {
   if (!diagnostics) return;
   const monitor = createVoiceTransportMonitor(category => recordDesktopDiagnostic('voice_transport', category));
   const active = () => !c.stop && pc.signalingState !== 'closed';
   let revision = 0,
    inFlight = false,
    availabilityAtSample = availabilityRevision();
   const expected = (peer: Peer) => ({
    send:
     !availability().muted &&
     !availability().deaf &&
     c.microphone.readyState === 'live' &&
     !c.microphone.muted &&
     pc.getSenders().some(({track}) => track?.kind === 'audio' && track.enabled && track.readyState === 'live'),
    receive:
     !availability().deaf &&
     peer.muted === false &&
     peer.deaf === false &&
     remote.getAudioTracks().some(track => track.readyState === 'live')
   });
   pc.oniceconnectionstatechange = () => {
    if (active()) {
     revision++;
     monitor.ice(pc.iceConnectionState);
    }
   };
   samplers.set(id, (peer, time) => {
    if (!active() || !iceIsConnected(pc.iceConnectionState)) return;
    if (availabilityAtSample !== availabilityRevision()) {
     monitor.reset();
     availabilityAtSample = availabilityRevision();
    }
    const before = expected(peer);
    if (!before.send) monitor.reset('send');
    if (!before.receive) monitor.reset('receive');
    if (inFlight) return;
    const sampledRevision = revision,
     sampledAvailability = availabilityRevision();
    inFlight = true;
    // Never wait for diagnostics in signaling; a hung read costs at most one slot per peer.
    void (async () => {
     try {
      const stats = await pc.getStats();
      const latest = diagnosticPeers.get(id);
      if (
       !latest ||
       !active() ||
       revision !== sampledRevision ||
       availabilityRevision() !== sampledAvailability ||
       !iceIsConnected(pc.iceConnectionState)
      )
       return;
      if (performance.now() - time > 5_000) {
       monitor.reset();
       return;
      }
      const after = expected(latest);
      monitor.sample(stats, {receive: before.receive && after.receive, send: before.send && after.send}, time);
     } catch {
      monitor.reset();
     } finally {
      inFlight = false;
     }
    })();
   });
  },
  forget(id: string) {
   samplers.delete(id);
  },
  sample(peers: Peer[], time: number) {
   if (!diagnostics) return;
   diagnosticPeers = new Map(peers.map(peer => [peer.client, peer]));
   if (time >= nextSample && samplers.size) {
    nextSample = time + 5_000;
    // Bound stats work in large calls and give each peer a turn.
    const entries = [...samplers];
    for (let i = 0; i < Math.min(4, entries.length); i++) {
     const [id, sample] = entries[sampleOffset++ % entries.length];
     const peer = diagnosticPeers.get(id);
     if (peer) sample(peer, time);
    }
    sampleOffset %= entries.length;
   }
  },
  clear() {
   samplers.clear();
   diagnosticPeers.clear();
  }
 };
}
