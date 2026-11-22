import {musicService} from './services/music-service';

const MIME='audio/mpeg', CHUNK=262144, MAX=10*1024*1024;
type Packet={mime:string;offset:number;nextOffset:number;totalBytes:number;data:string;eof:boolean};

export function openRoomMusicStream(room:string,id:string,durationMs:number,audio:HTMLAudioElement,onError:()=>void){
 if(typeof MediaSource==='undefined'||!MediaSource.isTypeSupported(MIME))throw new Error('MP3 streaming unavailable');
 const source=new MediaSource(),url=URL.createObjectURL(source);
 let closed=false,buffer:SourceBuffer|undefined,offset=0,total:number|undefined,failures=0,fetching=false,finished=false,timer=0;
 function schedule(delay=0){if(!closed){window.clearTimeout(timer);timer=window.setTimeout(()=>void pump(),delay)}}
 async function pump(){
  if(closed||!buffer||buffer.updating||fetching||source.readyState!=='open')return;
  try{
   const ranges=buffer.buffered,first=ranges.length?ranges.start(0):0,last=ranges.length?ranges.end(ranges.length-1):0;
   if(audio.currentTime-first>40){buffer.remove(first,audio.currentTime-25);return}
   if(finished){source.endOfStream();return}
   if(last-audio.currentTime>24){schedule(500);return}
   fetching=true;
   const p=await musicService.streamChunk<Packet>({room,id,offset});
   if(closed||source.readyState!=='open')return;
   if(!p||p.mime!==MIME||p.offset!==offset||!Number.isSafeInteger(p.totalBytes)||p.totalBytes<=0||p.totalBytes>MAX||(total!==undefined&&p.totalBytes!==total)||typeof p.data!=='string'||p.data.length>4*Math.ceil(CHUNK/3))throw new Error('Invalid audio chunk');
   const raw=atob(p.data);
   if(!raw.length||raw.length>CHUNK||p.nextOffset!==offset+raw.length||p.nextOffset>p.totalBytes||p.eof!==(p.nextOffset===p.totalBytes)||(!p.eof&&raw.length!==CHUNK))throw new Error('Invalid chunk range');
   buffer.appendBuffer(Uint8Array.from(raw,c=>c.charCodeAt(0)));
   offset=p.nextOffset;total=p.totalBytes;finished=p.eof;failures=0;
  }catch{if(!closed){if(++failures>=3)onError();else schedule(600*failures)}}
  finally{fetching=false}
 }
 const fail=()=>{if(!closed)onError()};
 const opened=()=>{
  if(closed)return;
  try{buffer=source.addSourceBuffer(MIME);buffer.mode='sequence';source.duration=durationMs/1000;buffer.addEventListener('updateend',updated);buffer.addEventListener('error',fail);schedule()}
  catch{fail()}
 };
 const updated=()=>schedule();
 source.addEventListener('sourceopen',opened,{once:true});
 return {url,close(){closed=true;window.clearTimeout(timer);source.removeEventListener('sourceopen',opened);buffer?.removeEventListener('updateend',updated);buffer?.removeEventListener('error',fail);URL.revokeObjectURL(url)}};
}
