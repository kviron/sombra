import {useEffect, useRef} from 'react';

/** One AudioContext for every participant: browsers limit how many can exist at once. */
let shared: AudioContext | undefined;
function context() {
 if (!shared || shared.state === 'closed') shared = new AudioContext();
 return shared;
}

/**
 * Draws the speaker level straight into a CSS custom property, so a talking participant
 * does not re-render React sixty times a second. Returns the element to attach.
 */
export function useLevelRail(stream: MediaStream | undefined | null, enabled: boolean) {
 const rail = useRef<HTMLDivElement | null>(null);
 useEffect(() => {
  const element = rail.current;
  if (!element) return;
  const track = enabled ? stream?.getAudioTracks().find(item => item.readyState === 'live') : undefined;
  if (!track) {
   element.style.setProperty('--level', '0');
   return;
  }
  const audio = context();
  if (audio.state === 'suspended') void audio.resume().catch(() => {});
  let source: MediaStreamAudioSourceNode | undefined, analyser: AnalyserNode | undefined;
  try {
   source = audio.createMediaStreamSource(new MediaStream([track]));
   analyser = audio.createAnalyser();
   analyser.fftSize = 512;
   analyser.smoothingTimeConstant = 0.55;
   source.connect(analyser);
  } catch {
   element.style.setProperty('--level', '0');
   return;
  }
  const samples = new Float32Array(analyser.fftSize);
  let frame = 0,
   level = 0,
   last = 0;
  // A voice occupies the top of the range; the floor cuts room noise so a quiet card stays still.
  const floor = 0.012,
   gain = 4.4;
  const tick = (now: number) => {
   const elapsed = last ? Math.min(120, now - last) : 16;
   last = now;
   analyser!.getFloatTimeDomainData(samples);
   let sum = 0;
   for (const value of samples) sum += value * value;
   const rms = Math.sqrt(sum / samples.length);
   const target = Math.min(1, Math.max(0, (rms - floor) * gain));
   // Fast attack, slow release: the crest jumps with the syllable and slides back down.
   const rate = target > level ? 0.55 : 0.12 * (16 / Math.max(16, elapsed));
   level += (target - level) * rate;
   if (level < 0.004) level = 0;
   element.style.setProperty('--level', level.toFixed(3));
   element.style.setProperty('--crest', (0.4 + level * 0.6).toFixed(3));
   frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return () => {
   cancelAnimationFrame(frame);
   source?.disconnect();
   element.style.setProperty('--level', '0');
  };
 }, [stream, enabled]);
 return rail;
}
