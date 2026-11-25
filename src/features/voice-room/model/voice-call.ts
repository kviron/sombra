import {setCapturedTrackEnabled, stopCapturedTrack, watchMicrophoneSilence} from './voice-input';
type MicrophoneGain = {
 context: AudioContext;
 source: MediaStreamAudioSourceNode;
 gain: GainNode;
 track: MediaStreamTrack;
};
export type Call = {
 room: string;
 client: string;
 stream: MediaStream;
 stop: boolean;
 stopTransport?: () => void;
 replaceTransportTrack?: (kind: TrackKind, track: MediaStreamTrack | null) => Promise<void>;
 setTransportMuted?: (muted: boolean) => void;
 audioOnly?: boolean;
 microphone: MediaStreamTrack;
 micGain?: MicrophoneGain;
 members?: Set<string>;
 stopInputWatch?: () => void;
 silenceWatch?: () => void;
};
export type TrackKind = 'audio' | 'video';

export function monitorOutgoingMicrophone(call: Call, track: MediaStreamTrack | null) {
 call.silenceWatch?.();
 call.silenceWatch = track ? watchMicrophoneSilence(track) : undefined;
}

export function microphoneSource(context: AudioContext, gain: GainNode, track: MediaStreamTrack) {
 const source = context.createMediaStreamSource(new MediaStream([track]));
 source.connect(gain);
 return source;
}
export function stopMicrophoneGain(graph: MicrophoneGain) {
 graph.source.disconnect();
 graph.gain.disconnect();
 graph.track.stop();
 void graph.context.close();
}
export async function replaceLocalTrack(
 c: Call,
 kind: TrackKind,
 track: MediaStreamTrack | null,
 onLocal: (stream: MediaStream) => void,
 {keepPrevious = false} = {}
) {
 if (c.stop) {
  if (track) stopCapturedTrack(track);
  return false;
 }
 const previous = c.stream.getTracks().find(t => t.kind === kind);
 if (track && previous) setCapturedTrackEnabled(track, previous.enabled);
 if (previous) c.stream.removeTrack(previous);
 if (track) c.stream.addTrack(track);
 try {
  await c.replaceTransportTrack?.(kind, track);
 } catch (error) {
  if (!c.stop) {
   if (track) c.stream.removeTrack(track);
   if (previous) {
    if (track) setCapturedTrackEnabled(previous, track.enabled);
    c.stream.addTrack(previous);
   }
   await c.replaceTransportTrack?.(kind, previous ?? null).catch(() => {});
  }
  if (track) stopCapturedTrack(track);
  if (c.stop && !keepPrevious && previous) stopCapturedTrack(previous);
  throw error;
 }
 if (!keepPrevious && previous) stopCapturedTrack(previous);
 if (c.stop) {
  if (track) stopCapturedTrack(track);
  return false;
 }
 if (kind === 'audio') monitorOutgoingMicrophone(c, track);
 onLocal(new MediaStream(c.stream.getTracks()));
 return true;
}

export function stopCall(c: Call) {
 if (c.stop) return;
 c.stop = true;
 c.stopTransport?.();
 c.stopInputWatch?.();
 c.silenceWatch?.();
 c.stream
  .getTracks()
  .filter(track => track !== c.microphone && track !== c.micGain?.track)
  .forEach(stopCapturedTrack);
 stopCapturedTrack(c.microphone);
 if (c.micGain) stopMicrophoneGain(c.micGain);
}

// Non-reactive resources and operation ownership; UI values live in VoiceStore.
export type VoiceRuntime = {
 call: Call | null;
 pending: symbol | null;
 changingMedia: boolean;
 generation: number;
 availabilityRevision: number;
 preferredMicVolume: number;
};
