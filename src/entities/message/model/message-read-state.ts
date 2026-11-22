import {useEffect,useRef} from 'react';
import {api,type ChatState} from '@/shared/api/backend';

/** Long messages use the viewport as denominator, not their entire height. */
export function sufficientlyVisible(height:number,visible:number,viewport:number){return visible>=Math.min(40,height)&&visible>=Math.min(height,viewport)*0.5}

export function observeMessageReads({root,actor,channel,eligible,send,onRead,active=()=>true}:{root:HTMLElement;actor:string;channel:string;eligible:Set<string>;send:(ids:string[])=>Promise<unknown>;onRead?:(ids:string[])=>void;active?:()=>boolean}){
 let disposed=false,inflight=false;
 const completed=new Set<string>(),queued=new Set<string>(),visible=new Set<string>(),timers=new Map<string,ReturnType<typeof setTimeout>>();
 let batch:ReturnType<typeof setTimeout>|undefined;
 const allowed=()=>!disposed&&active()&&document.visibilityState==='visible'&&document.hasFocus()&&!document.querySelector('[role="dialog"],[data-slot="dialog-overlay"],[data-slot="alert-dialog-overlay"]');
 function stop(){for(const timer of timers.values())clearTimeout(timer);timers.clear();queued.clear();if(batch)clearTimeout(batch);batch=undefined}
 function dwell(id:string){if(!allowed()||completed.has(id)||queued.has(id)||timers.has(id))return;timers.set(id,setTimeout(()=>{timers.delete(id);if(allowed()&&visible.has(id)){queued.add(id);schedule()}},500))}
 function schedule(){if(!batch&&!inflight)batch=setTimeout(()=>{batch=undefined;void flush()},400)}
 async function flush(){if(!allowed()){stop();return}const ids=[...queued].filter(id=>visible.has(id)&&!completed.has(id)).slice(0,100);ids.forEach(id=>queued.delete(id));if(!ids.length)return;inflight=true;try{await send(ids);if(!disposed){ids.forEach(id=>{completed.add(id);queued.delete(id)});onRead?.(ids)}}catch{/* A failed batch remains eligible while visible. */}finally{inflight=false;if(!disposed){for(const id of visible)dwell(id);if(queued.size)schedule()}}}
 const observer=new IntersectionObserver(entries=>{for(const entry of entries){const id=(entry.target as HTMLElement).dataset.readMessageId;if(!id)continue;const viewport=entry.rootBounds?.height||window.innerHeight;if(entry.isIntersecting&&sufficientlyVisible(entry.boundingClientRect.height,entry.intersectionRect.height,viewport)){visible.add(id);dwell(id)}else{visible.delete(id);queued.delete(id);const timer=timers.get(id);if(timer)clearTimeout(timer);timers.delete(id)}}},{root,threshold:Array.from({length:101},(_,i)=>i/100)});
 const observed=new Set<Element>();
 function scan(){for(const element of root.querySelectorAll<HTMLElement>('[data-read-message-id]')){if(eligible.has(element.dataset.readMessageId||'')&&!observed.has(element)){observed.add(element);observer.observe(element)}}if(!allowed())stop();else for(const id of visible)dwell(id)}
 const mutation=new MutationObserver(scan);mutation.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['role','data-state']});scan();
 function attention(){if(!allowed())stop();else for(const id of visible)dwell(id)}
 const auth=()=>{disposed=true;stop();observer.disconnect()};
 window.addEventListener('authchange',auth);
 document.addEventListener('visibilitychange',attention);window.addEventListener('focus',attention);window.addEventListener('blur',attention);
 return()=>{disposed=true;stop();observer.disconnect();mutation.disconnect();window.removeEventListener('authchange',auth);document.removeEventListener('visibilitychange',attention);window.removeEventListener('focus',attention);window.removeEventListener('blur',attention);void actor;void channel};
}

export function useMessageReadState(state:ChatState|null,channel:string,blocked:boolean,onRead?:(ids:string[])=>void){
 const accepted=useRef(onRead);accepted.current=onRead;
 const actor=state?.me.id||'';
 const ids=state?.messages.filter(m=>m.channel===channel&&m.user!==actor).map(m=>m.id).join('\n')||'';
 useEffect(()=>{if(!state?.readReceiptsSupported||state.me.bot||!actor||!channel||blocked||typeof IntersectionObserver==='undefined')return;
 const root=document.querySelector<HTMLElement>('.voice-messages')||document.querySelector<HTMLElement>('.message-scroll');if(!root)return;
 return observeMessageReads({root,actor,channel,eligible:new Set(ids.split('\n')),send:messages=>api('mark_messages_read',{channel,messages}),onRead:ids=>accepted.current?.(ids)});
 },[actor,channel,blocked,state?.readReceiptsSupported,ids]);
}
