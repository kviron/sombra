import {useRef,useState} from 'react';
import {Dialog as DialogPrimitive} from 'radix-ui';
import {Phone,PhoneOff,Video,Users} from 'lucide-react';
import {api,type ChatState,type DialogCall} from '@/shared/api/backend';
import {Button} from '@/shared/ui/button';
import {UserAvatar} from '@/shared/ui/user-avatar';
import type {Voice} from './use-voice';
import './dialog-calls.css';
import {useIncomingRingtone} from './use-incoming-ringtone';

export function useDialogCalls({state,voice,refresh,onOpenDialog}:{state:ChatState|null;voice:Voice;refresh:()=>Promise<unknown>;onOpenDialog:(id:string)=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const [handled,setHandled]=useState<Record<string,boolean>>({});
 const pending=useRef(false);
 const calls=state?.dialogCalls||[];
 const incoming=calls.find(call=>call.caller!==state?.me.id&&!call.participants.includes(state?.me.id||'')&&!call.declined.includes(state?.me.id||'')&&voice.room!==call.id&&!handled[call.id]);
 useIncomingRingtone(incoming&&!busy&&!voice.busy?incoming.id:undefined,voice.deaf,voice.preferences.speaker,voice.preferences.volume);
 async function join(call:DialogCall,video=call.video){
  if(pending.current||voice.busy)return;
  pending.current=true;setBusy(true);setError('');
  try{
   const joined=await voice.join(call.id,video);
   if(!joined){setError('Не удалось подключиться. Проверьте разрешения микрофона и камеры.');return}
   setHandled(previous=>({...previous,[call.id]:true}));
   onOpenDialog(call.dialog);
   await refresh();
  }catch(reason){setError((reason as Error).message)}
  finally{pending.current=false;setBusy(false)}
 }
 async function start(dialog:string,video:boolean){
  if(pending.current||voice.busy)return;
  const existing=calls.find(call=>call.dialog===dialog);
  if(existing){
   if(voice.room===existing.id){if(video&&!voice.camera)await voice.toggleCamera();return}
   await join(existing,video);return;
  }
  pending.current=true;setBusy(true);setError('');
  let created:DialogCall|undefined;
  try{
   created=await api<DialogCall>('dialog_call_start',{dialog,video});
   const joined=await voice.join(created.id,video);
   if(!joined){
    await api('dialog_call_cancel',{call:created.id}).catch(()=>{});
    setError('Не удалось начать звонок. Проверьте доступ к микрофону и камере.');
   }else{setHandled(previous=>({...previous,[created!.id]:true}));onOpenDialog(dialog)}
   await refresh();
  }catch(reason){setError((reason as Error).message)}
  finally{pending.current=false;setBusy(false)}
 }
 async function decline(call:DialogCall){
  if(pending.current)return;
  pending.current=true;setBusy(true);setError('');
  try{await api('dialog_call_decline',{call:call.id});setHandled(previous=>({...previous,[call.id]:true}));await refresh()}
  catch(reason){setError((reason as Error).message)}
  finally{pending.current=false;setBusy(false)}
 }
 return {calls,incoming,busy,error,start,join,decline,clearError:()=>setError('')};
}

export function DialogCallBanner({call,joined,busy,onJoin,onLeave}:{call:DialogCall;joined:boolean;busy:boolean;onJoin:()=>void;onLeave:()=>void}){
 return <div className="dialog-call-banner" role="status"><span className="dialog-call-banner-icon">{call.video?<Video size={18}/>:<Phone size={18}/>}</span><div><strong>{joined?'Вы в звонке':'В диалоге идёт звонок'}</strong><small>{call.participants.length?`На связи: ${call.participants.length}`:'Ожидание участников'} · {call.video?'Видео':'Аудио'}</small></div><Button type="button" size="sm" variant={joined?'destructive':'secondary'} disabled={busy} onClick={joined?onLeave:onJoin}>{joined?'Выйти':'Присоединиться'}</Button></div>;
}

export function IncomingDialogCall({call,state,busy,error,onAccept,onDecline}:{call:DialogCall;state:ChatState;busy:boolean;error:string;onAccept:(video:boolean)=>void;onDecline:()=>void}){
 const caller=state.users.find(user=>user.id===call.caller);
 const dialog=state.dialogs.find(item=>item.id===call.dialog);
 const group=!!dialog&&dialog.members.length>2;
 return <DialogPrimitive.Root open onOpenChange={open=>{if(!open&&!busy)onDecline()}}><DialogPrimitive.Portal><DialogPrimitive.Overlay className="dialog-call-overlay"/><DialogPrimitive.Content className="incoming-dialog-call" onInteractOutside={event=>event.preventDefault()} onEscapeKeyDown={event=>{event.preventDefault();if(!busy)onDecline()}}>
  {caller?<UserAvatar user={caller} size="xl"/>:<Users size={48}/>}
  <DialogPrimitive.Title>{caller?.name||'Участник Sombra'}</DialogPrimitive.Title>
  <DialogPrimitive.Description>{group?'Входящий групповой ': 'Входящий '}{call.video?'видеозвонок':'аудиозвонок'}{group&&dialog?.name?` · ${dialog.name}`:''}</DialogPrimitive.Description>
  {group&&<p className="incoming-call-members">Приглашены все участники диалога · {dialog.members.length} человек</p>}
  {error&&<p role="alert" className="incoming-call-error">{error}</p>}
  <div className="incoming-call-actions"><Button type="button" variant="destructive" disabled={busy} onClick={onDecline}><PhoneOff size={18}/>Отклонить</Button><Button type="button" className="accept-call" disabled={busy} onClick={()=>onAccept(call.video)}>{call.video?<Video size={18}/>:<Phone size={18}/>}Ответить</Button></div>
  {call.video&&<Button type="button" variant="ghost" disabled={busy} onClick={()=>onAccept(false)}>Ответить без камеры</Button>}
 </DialogPrimitive.Content></DialogPrimitive.Portal></DialogPrimitive.Root>;
}
