import {useEffect,useRef} from 'react';
import {invoke,isTauri} from '@tauri-apps/api/core';
import {toast} from 'sonner';
import type {ChatState} from '@/shared/api/backend';
import {DirectMessageToast} from './direct-message-toast';
import {newDirectMessages} from './new-direct-messages';

export function useDirectMessageNotifications(state:ChatState|null){
 const cursor=useRef<{user:string;seen:Set<string>}|null>(null);
 const sound=useRef<HTMLAudioElement|null>(null);
 useEffect(()=>{
  if(!state||!isTauri())return;
  const initial=cursor.current?.user!==state.me.id;
  if(initial)cursor.current={user:state.me.id,seen:new Set()};
  const notifications=newDirectMessages(state,cursor.current!.seen,initial);
  if(!notifications.length)return;
  function playSound(){
   sound.current??=new Audio(new URL('./message-tone.wav',import.meta.url).href);
   sound.current.currentTime=0;
   void sound.current.play().catch(()=>{});
  }
  for(const {id,sender,text,avatar} of notifications){
   void invoke('notify_direct_message',{sender,text,avatar}).catch(()=>{
    toast.custom(toastId=><DirectMessageToast sender={sender} text={text} avatar={avatar}
     onClose={()=>toast.dismiss(toastId)}/>,{id,duration:5500});
    playSound();
   });
  }
 },[state]);
}
