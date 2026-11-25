import {mediaDevicesStore, selectSpeakerOutput} from '@/shared/lib/media-devices';

const voiceCues = {
 joined: new URL('../assets/voice-peer-joined.wav', import.meta.url).href,
 left: new URL('../assets/voice-left.wav', import.meta.url).href
};

export async function playVoiceCue(cue: keyof typeof voiceCues, preferredSpeaker: string) {
 const speaker = selectSpeakerOutput(mediaDevicesStore.getState(), preferredSpeaker);
 const audio = new Audio();
 if (speaker && speaker !== 'default' && audio.setSinkId) {
  await audio.setSinkId(speaker).catch(() => {}); // Use the system output if the selected device is unavailable.
 }
 audio.src = voiceCues[cue];
 await audio.play().catch(() => {});
}

const ringtone = new URL('../assets/call-ringtone.wav', import.meta.url).href;

export function startIncomingRingtone(speaker: string, volume: number) {
 let active = true;
 const audio = new Audio(ringtone);
 audio.loop = true;
 audio.volume = Math.max(0, Math.min(1, volume / 100)) * 0.75;
 function play() {
  if (active && audio.paused) void audio.play().catch(() => {});
 }
 // A browser may block the initial autoplay. Retry only on a real user gesture.
 document.addEventListener('pointerdown', play);
 document.addEventListener('keydown', play);
 void (async () => {
  if (speaker && speaker !== 'default' && audio.setSinkId) await audio.setSinkId(speaker).catch(() => {});
  play();
 })();
 return () => {
  active = false;
  document.removeEventListener('pointerdown', play);
  document.removeEventListener('keydown', play);
  audio.pause();
  audio.currentTime = 0;
  audio.removeAttribute('src');
  audio.load();
 };
}
