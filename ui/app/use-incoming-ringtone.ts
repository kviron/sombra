import {useEffect} from 'react';

const ringtone=new URL('./call-ringtone.wav',import.meta.url).href;

/** One loop per current invitation; stop on answer, decline, expiry or unmount. */
export function useIncomingRingtone(callId:string|undefined,muted:boolean,speaker:string,volume:number){
 useEffect(()=>{
  if(!callId||muted)return;
  let active=true;
  const audio=new Audio(ringtone);
  audio.loop=true;
  audio.volume=Math.max(0,Math.min(1,volume/100))*0.75;
  function play(){if(active&&audio.paused)void audio.play().catch(()=>{});}
  // A browser may block the initial autoplay. Retry only on a real user gesture.
  document.addEventListener('pointerdown',play);
  document.addEventListener('keydown',play);
  void (async()=>{
   if(speaker&&speaker!=='default'&&audio.setSinkId)await audio.setSinkId(speaker).catch(()=>{});
   play();
  })();
  return()=>{
   active=false;
   document.removeEventListener('pointerdown',play);
   document.removeEventListener('keydown',play);
   audio.pause();
   audio.currentTime=0;
   audio.removeAttribute('src');
   audio.load();
  };
 },[callId,muted,speaker,volume]);
}
