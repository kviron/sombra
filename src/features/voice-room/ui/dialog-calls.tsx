import {useEffect,useRef,useState} from 'react';
import {Dialog as DialogPrimitive} from 'radix-ui';
import {Phone,PhoneOff,Video,Users} from 'lucide-react';
import {type ChatState,type DialogCall} from '@/shared/types';
import {callService} from '../model/services/call-service';
import {Button} from '@/shared/ui/button';
import {UserAvatar} from '@/shared/ui/user-avatar';
import type {Voice} from '../model/use-voice';
import './dialog-calls.css';
import {useIncomingRingtone} from '../model/use-incoming-ringtone';

export function useDialogCalls({state,voice,refresh,onOpenDialog}:{state:ChatState|null;voice:Voice;refresh:()=>Promise<unknown>;onOpenDialog:(id:string)=>void}){
 const [operation,setOperation]=useState<{id:string;kind:'join'|'start'|'decline'}|null>(null),[error,setError]=useState('');
 const [,tick]=useState(0);
 const [declining,setDeclining]=useState<{id:string;epoch:number}|null>(null);
 const declinePending=useRef<{id:string;epoch:number}|null>(null);
 const scope=useRef({account:state?.me.id,epoch:0,handled:new Set<string>(),pending:null as null|{id:string;kind:'join'|'start'|'decline';epoch:number}});
 const latest=useRef({state,voice});latest.current={state,voice};
 const account=state?.me.id;
 if(scope.current.account!==account){scope.current={account,epoch:scope.current.epoch+1,handled:new Set(),pending:null};declinePending.current=null}
 const calls=state?.dialogCalls||[];
 const live=(call:DialogCall)=>!call.empty_since||call.empty_since*1000+60000>Date.now();
 const incoming=calls.find(call=>live(call)&&call.caller!==account&&!call.participants.includes(account||'')&&!call.declined.includes(account||'')&&voice.room!==call.id&&!scope.current.handled.has(call.id));
 const operationBusy=!!operation&&scope.current.pending===operation;
 const declineBusy=!!declining&&declinePending.current===declining;
 const busy=operationBusy||declineBusy;
 const incomingBusy=!!((operationBusy&&operation?.id===incoming?.id)||(declineBusy&&declining?.id===incoming?.id));
 useIncomingRingtone(incoming&&!incomingBusy?incoming.id:undefined,voice.deaf,voice.preferences.speaker,voice.preferences.volume);
 useEffect(()=>{const timer=setInterval(()=>tick(n=>n+1),1000);return()=>clearInterval(timer)},[]);
 useEffect(()=>{
  const pending=scope.current.pending;
  if(pending&&pending.kind==='join'&&!calls.some(call=>call.id===pending.id&&live(call))){
   scope.current.pending=null;setOperation(null);voice.leave();
  }
 },[state,incoming?.id]);
 useEffect(()=>{setError('');setOperation(null);const owner=scope.current;return()=>{owner.epoch++;if(owner.pending?.kind==='join'||owner.pending?.kind==='start')latest.current.voice.leave();owner.pending=null}},[account]);
 function begin(id:string,kind:'join'|'start'|'decline'){
  if(scope.current.pending||declinePending.current?.id===id)return null;
  const op={id,kind,epoch:scope.current.epoch};scope.current.pending=op;setOperation(op);setError('');return op;
 }
 function current(op:{epoch:number}){return scope.current.epoch===op.epoch&&scope.current.pending===op&&latest.current.state?.me.id===account}
 function finish(op:{epoch:number}){if(current(op)){scope.current.pending=null;setOperation(null)}}
 function update(){void refresh().catch(()=>{/* Poll will retry; refreshing must never hold the call action lock. */})}
 async function join(requested:DialogCall,video=requested.video){
  const call=latest.current.state?.dialogCalls?.find(item=>item.id===requested.id);
  if(!call||!live(call))return;
  const op=begin(call.id,'join');if(!op)return;
  try{
   if(voice.busy){setError('Подключение или настройка устройства ещё выполняется. Повторите ответ или отклоните звонок.');return}
   const joined=await voice.join(call.id,video);
   if(!current(op))return;
   if(!joined){setError('Не удалось подключиться. Проверьте разрешения микрофона и камеры и повторите ответ.');return}
   scope.current.handled.add(call.id);onOpenDialog(call.dialog);update();
  }catch(reason){if(current(op))setError((reason as Error).message||'Не удалось ответить. Повторите попытку.')}
  finally{finish(op)}
 }
 async function start(dialog:string,video:boolean){
  const existing=latest.current.state?.dialogCalls?.find(call=>call.dialog===dialog&&live(call));
  if(existing){if(voice.room===existing.id){if(video&&!voice.camera)await voice.toggleCamera();return}await join(existing,video);return}
  if(voice.busy)return;
  const op=begin(dialog,'start');if(!op)return;
  let created:DialogCall|undefined;
  try{
   created=await callService.start<DialogCall>({dialog,video});if(!current(op))return;
   const joined=await voice.join(created.id,video);if(!current(op))return;
   if(!joined){await callService.cancel({call:created.id}).catch(()=>{});if(current(op))setError('Не удалось начать звонок. Проверьте доступ к микрофону и камере.')}
   else{scope.current.handled.add(created.id);onOpenDialog(dialog)}
   update();
  }catch(reason){if(current(op))setError((reason as Error).message)}
  finally{finish(op)}
 }
 async function decline(requested:DialogCall){
  // Closing is a local user decision, never conditional on network/server progress.
  // Retain this ID for the account lifetime so stale polls cannot reopen it.
  scope.current.handled.add(requested.id);tick(n=>n+1);
  const pending=scope.current.pending;
  if(pending?.id===requested.id&&pending.kind==='join'){
   scope.current.pending=null;setOperation(null);voice.leave();
  }
  const call=latest.current.state?.dialogCalls?.find(item=>item.id===requested.id);
  if(!call||declinePending.current?.id===call.id)return;
  const op={id:call.id,epoch:scope.current.epoch};declinePending.current=op;setDeclining(op);setError('');
  const valid=()=>scope.current.epoch===op.epoch&&declinePending.current===op&&latest.current.state?.me.id===account;
  try{await callService.decline({call:call.id});if(!valid())return;scope.current.handled.add(call.id);update()}
  catch{if(valid())setError('Приглашение закрыто на этом устройстве. Сервер не подтвердил отклонение звонка.')}
  finally{if(valid()){declinePending.current=null;setDeclining(null)}}
 }
 return {calls,incoming,busy,incomingBusy,incomingDeclining:!!(declineBusy&&declining?.id===incoming?.id),error,start,join,decline,clearError:()=>setError('')};
}
export function DialogCallBanner({call,joined,busy,onJoin,onLeave}:{call:DialogCall;joined:boolean;busy:boolean;onJoin:()=>void;onLeave:()=>void}){
 return <div className="dialog-call-banner" role="status"><span className="dialog-call-banner-icon">{call.video?<Video size={18}/>:<Phone size={18}/>}</span><div><strong>{joined?'Вы в звонке':'В диалоге идёт звонок'}</strong><small>{call.participants.length?`На связи: ${call.participants.length}`:'Ожидание участников'} · {call.video?'Видео':'Аудио'}</small></div><Button type="button" size="sm" variant={joined?'destructive':'secondary'} disabled={busy} onClick={joined?onLeave:onJoin}>{joined?'Выйти':'Присоединиться'}</Button></div>;
}

export function IncomingDialogCall({call,state,busy,declining=busy,error,hasOtherVoice=false,onAccept,onDecline}:{call:DialogCall;state:ChatState;busy:boolean;declining?:boolean;error:string;hasOtherVoice?:boolean;onAccept:(video:boolean)=>void;onDecline:()=>void}){
 const caller=state.users.find(user=>user.id===call.caller);
 const dialog=state.dialogs.find(item=>item.id===call.dialog);
 const group=!!dialog&&dialog.members.length>2;
 return <DialogPrimitive.Root open modal={false} onOpenChange={open=>{if(!open)onDecline()}}><DialogPrimitive.Portal><DialogPrimitive.Content className="incoming-dialog-call" data-call-id={call.id} aria-busy={busy} onOpenAutoFocus={event=>event.preventDefault()} onCloseAutoFocus={event=>event.preventDefault()} onInteractOutside={event=>event.preventDefault()} onEscapeKeyDown={event=>{event.preventDefault();onDecline()}}>
  <button type="button" className="incoming-call-close" aria-label="Отклонить звонок" onClick={onDecline}>×</button>
   {caller?<UserAvatar user={caller} size="xl" decoration={caller.decorations?.avatar}/>:<Users size={48}/>}
  <DialogPrimitive.Title>{caller?.name||'Участник Sombra'}</DialogPrimitive.Title>
  <DialogPrimitive.Description>{group?'Входящий групповой ': 'Входящий '}{call.video?'видеозвонок':'аудиозвонок'}{group&&dialog?.name?` · ${dialog.name}`:''}</DialogPrimitive.Description>
  {group&&<p className="incoming-call-members">Приглашены все участники диалога · {dialog.members.length} человек</p>}
  {hasOtherVoice&&<p className="incoming-call-switch">Ответ завершит текущее голосовое подключение. Отклонение оставит его без изменений.</p>}
   {error&&<p role="alert" className="incoming-call-error">{error}</p>}
  <div className="incoming-call-actions"><Button type="button" variant="destructive" data-call-action="decline" disabled={declining} onClick={onDecline}><PhoneOff size={18}/>Отклонить</Button><Button type="button" className="accept-call" data-call-action="accept" disabled={busy} onClick={()=>onAccept(call.video)}>{call.video?<Video size={18}/>:<Phone size={18}/>}{hasOtherVoice?'Выйти и ответить':'Ответить'}</Button></div>
  {call.video&&<Button type="button" variant="ghost" disabled={busy} onClick={()=>onAccept(false)}>Ответить без камеры</Button>}
 </DialogPrimitive.Content></DialogPrimitive.Portal></DialogPrimitive.Root>;
}
