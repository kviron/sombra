import {useEffect, useState} from 'react';

const meterFloor = 0.005;
const meterFullScale = 0.2;

// Observe the call stream without opening another microphone or playing it back.
export function VoiceLevel({
 stream,
 muted = false,
 name
}: {
 stream?: MediaStream | null;
 muted?: boolean;
 name: string;
}) {
 const [level, setLevel] = useState(0);
 useEffect(() => {
  setLevel(0);
  if (muted || !stream?.getAudioTracks().length) return;
  let context: AudioContext | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  try {
   context = new AudioContext();
   const analyser = context.createAnalyser();
   analyser.fftSize = 512;
   source = context.createMediaStreamSource(stream);
   source.connect(analyser);
   void context.resume().catch(() => {});
   const samples = new Float32Array(analyser.fftSize);
   timer = setInterval(() => {
    const active = stream.getAudioTracks().some(track => track.enabled && !track.muted && track.readyState === 'live');
    if (!active) {
     setLevel(0);
     return;
    }
    analyser.getFloatTimeDomainData(samples);
    const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
    // A logarithmic display gives quiet speech more room on the short sidebar meter.
    const displayed = Math.log(Math.max(rms, meterFloor) / meterFloor) / Math.log(meterFullScale / meterFloor);
    setLevel(Math.min(100, Math.round(displayed * 100)));
   }, 100);
  } catch {
   /* A missing audio analyser must not interrupt the call. */
  }
  return () => {
   clearInterval(timer);
   source?.disconnect();
   if (context) void context.close().catch(() => {});
  };
 }, [stream, muted]);
 const value = muted ? 0 : level;
 const label = `Уровень микрофона — ${name}`;
 return (
  <span
   className={`voice-channel-level${muted ? 'is-muted' : ''}`}
   role="meter"
   aria-label={label}
   aria-valuemin={0}
   aria-valuemax={100}
   aria-valuenow={value}
   aria-valuetext={muted ? 'Микрофон выключен' : `${value}%`}
   title={muted ? 'Микрофон выключен' : `${label}: ${value}%`}
  >
   <span aria-hidden="true" style={{transform: `scaleY(${value / 100})`}} />
  </span>
 );
}
