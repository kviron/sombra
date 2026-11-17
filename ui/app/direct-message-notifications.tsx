import {useEffect,useRef} from 'react';
import {invoke,isTauri} from '@tauri-apps/api/core';
import {getCurrentWindow} from '@tauri-apps/api/window';
import {toast} from 'sonner';
import type {ChatState} from '@/shared/api/backend';
import {DirectMessageToast} from './direct-message-toast';
import {batchChatNotifications,createChatNotificationCursor,newChatMessages,notificationEligible} from './new-chat-messages';
import type {ChatNotification,ChatNotificationCursor} from './new-chat-messages';

export function useDirectMessageNotifications(state:ChatState|null,options?:{activeChannel?:string;settingsOpen?:boolean}){
 const cursor=useRef<ChatNotificationCursor|null>(null);
 const sound=useRef<HTMLAudioElement|null>(null);
 const current=useRef({state,options});
 current.current={state,options};
 useEffect(()=>{
  if(!state){cursor.current=null;return;}
  if(cursor.current?.user!==state.me.id)cursor.current=createChatNotificationCursor(state.me.id);
  const batchCursor=cursor.current;
  // Consume synchronously, including suppressed messages; focus IPC must never delay the cursor.
  const incoming=newChatMessages(state,cursor.current);
  if(!incoming.length)return;
  const account=state.me.id;
  const native=isTauri();
  function playSound(){
   sound.current??=new Audio(new URL('./message-tone.wav',import.meta.url).href);
   sound.current.currentTime=0;
   void sound.current.play().catch(()=>{});
  }
  async function eligibleNotifications(){
   let focused=document.hasFocus();
   if(native){try{focused=await getCurrentWindow().isFocused();}catch{/* Browser focus is the conservative fallback. */}}
   if(current.current.state?.me.id!==account||cursor.current!==batchCursor)return [];
   const active=current.current.options;
   const latest=current.current.state;
   const preferences=latest.chatPreferences;
   return batchChatNotifications(incoming.filter(message=>{
    const group=latest.groups.some(item=>item.channels.some(channel=>channel.id===message.channel));
    const visible=group||latest.dialogs.some(dialog=>dialog.id===message.channel);
    if(!visible||preferences?.dialogs?.[message.channel]?.muted)return false;
    if(group?preferences?.notifications?.groups===false:preferences?.notifications?.direct===false)return false;
    return notificationEligible(message.channel,active?.activeChannel,!!active?.settingsOpen,document.visibilityState==='visible',focused);
   }));
  }
  async function deliver(){
   const notifications=await eligibleNotifications();
   if(!notifications.length)return;
   function showToasts(items:ChatNotification[]){
    if(!items.length)return;
    for(const {id,sender,text,avatar} of items){
     toast.custom(toastId=><DirectMessageToast sender={sender} text={text} avatar={avatar}
      onClose={()=>toast.dismiss(toastId)}/>,{id:`chat-${account}-${id}`,duration:5500});
    }
    playSound();
   }
   if(!native){showToasts(notifications);return;}
   // Native IPC plays its own tone. One summary invocation prevents a sound storm.
   const notification=notifications.length===1?notifications[0]:{
    sender:`Sombra · ${notifications.length} чатов`,
    text:Array.from(notifications.map(item=>`${item.sender}: ${item.text}`).join('\n')).slice(0,220).join(''),
    avatar:undefined,
   };
   try{await invoke('notify_direct_message',{sender:notification.sender,text:notification.text,avatar:notification.avatar});}
   catch{showToasts(await eligibleNotifications());}
  }
  void deliver();
 },[state,options?.activeChannel,options?.settingsOpen]);
}
