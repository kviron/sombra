import {useEffect,useRef} from 'react';
import {invoke,isTauri} from '@tauri-apps/api/core';
import {getCurrentWindow} from '@tauri-apps/api/window';
import {toast} from 'sonner';
import type {ChatState} from '@/shared/types';
import {DirectMessageToast} from './direct-message-toast';
import {batchChatNotifications,createChatNotificationCursor,newChatMessages,notificationEligible} from '@/entities/conversation';
import type {ChatNotification,ChatNotificationCursor} from '@/entities/conversation';
import type {NotificationTarget} from '../model/notification-target';

export function useDirectMessageNotifications(state:ChatState|null,options?:{activeChannel?:string;settingsOpen?:boolean;onActivate?:(target:NotificationTarget)=>void}){
 const cursor=useRef<ChatNotificationCursor|null>(null);
 const sound=useRef<HTMLAudioElement|null>(null);
 const current=useRef({state,options});current.current={state,options};
 useEffect(()=>{
  if(!state){cursor.current=null;return;}
  if(cursor.current?.user!==state.me.id)cursor.current=createChatNotificationCursor(state.me.id);
  const batchCursor=cursor.current;
  const incoming=newChatMessages(state,cursor.current);
  if(!incoming.length)return;
  const account=state.me.id,native=isTauri();
  function playSound(){sound.current??=new Audio(new URL('../assets/message-tone.wav',import.meta.url).href);sound.current.currentTime=0;void sound.current.play().catch(()=>{});}
  async function eligibleNotifications(){
   let focused=document.hasFocus();
   if(native){try{focused=await getCurrentWindow().isFocused();}catch{/* Browser focus is the conservative fallback. */}}
   if(current.current.state?.me.id!==account||cursor.current!==batchCursor)return [];
   const active=current.current.options,latest=current.current.state,preferences=latest.chatPreferences;
   return batchChatNotifications(incoming.filter(message=>{
    const group=latest.groups.some(item=>item.channels.some(channel=>channel.id===message.channel));
    const visible=group||latest.dialogs.some(dialog=>dialog.id===message.channel);
    if(!visible||preferences?.dialogs?.[message.channel]?.muted)return false;
    if(group?preferences?.notifications?.groups===false:preferences?.notifications?.direct===false)return false;
    return notificationEligible(message.channel,active?.activeChannel,!!active?.settingsOpen,document.visibilityState==='visible',focused);
   }));
  }
  async function deliver(){
   const notifications=await eligibleNotifications();if(!notifications.length)return;
   function showToasts(items:ChatNotification[],audible=true){
    if(!items.length||current.current.state?.me.id!==account)return;
    for(const {id,channel,sender,text,avatar} of items){
     const target={account,channel,message:id};
     toast.custom(toastId=><DirectMessageToast sender={sender} text={text} avatar={avatar}
      onOpen={()=>{toast.dismiss(toastId);current.current.options?.onActivate?.(target)}}
      onClose={()=>toast.dismiss(toastId)}/>,{id:`chat-${account}-${id}`,duration:5500});
    }
    if(audible)playSound();
   }
   if(!native){showToasts(notifications);return;}
   // Keep each chat's own target; a multi-chat summary cannot identify the clicked conversation.
   let audible=true;const failed:ChatNotification[]=[];
   for(const item of notifications){
    if(current.current.state?.me.id!==account||cursor.current!==batchCursor)return;
    try{await invoke('notify_direct_message',{sender:item.sender,text:item.text,avatar:item.avatar,target:{account,channel:item.channel,message:item.id},silent:!audible});audible=false;}
    catch{failed.push(item)}
   }
   const eligible=await eligibleNotifications();
   showToasts(failed.filter(item=>eligible.some(other=>other.id===item.id)),audible);
  }
  void deliver();
 },[state,options?.activeChannel,options?.settingsOpen]);
}
