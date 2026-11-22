import {useEffect,useRef,useState,type RefObject} from 'react';
import {Dialog} from 'radix-ui';
import {X} from 'lucide-react';
import {type ChatState,type ChatMessage} from '@/shared/api/backend';
import {messageService} from '@/entities/message';
import {UserAvatar} from '@/shared/ui/user-avatar';
import './message-readers-dialog.css';
type Reader={user:string;seenAt:number};
export function MessageReadersDialog({state,message,trigger,onClose}:{state:ChatState;message:ChatMessage;trigger:RefObject<HTMLElement|null>;onClose:()=>void}){
 const close=useRef(onClose);close.current=onClose;
 const owner=state.me.id,channel=message.channel,id=message.id;
 const [readers,setReaders]=useState<Reader[]|null>(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 useEffect(()=>{let current=true;setReaders(null);setError('');if(!state.readReceiptsSupported||message.user!==owner){close.current();return}
 const auth=()=>{current=false;setReaders(null);close.current()};window.addEventListener('authchange',auth);
 void messageService.readers<{readers:Reader[]}>({message:id}).then(result=>{if(current)setReaders(result.readers.filter(reader=>reader.user!==owner))}).catch(reason=>{if(current)setError(reason instanceof Error?reason.message:'Не удалось загрузить просмотры')});
 return()=>{current=false;window.removeEventListener('authchange',auth)};
 },[owner,channel,id,attempt,state.readReceiptsSupported,message.user]);
 return <Dialog.Root open onOpenChange={open=>{if(!open)close.current()}}><Dialog.Portal><Dialog.Overlay className="readers-overlay"/><Dialog.Content className="readers-dialog" aria-describedby={undefined} onCloseAutoFocus={event=>{event.preventDefault();trigger.current?.focus({preventScroll:true})}}><header><Dialog.Title>Кто посмотрел</Dialog.Title><Dialog.Close aria-label="Закрыть"><X size={20}/></Dialog.Close></header>
 {error?<div role="alert"><p>{error}</p><button type="button" onClick={()=>setAttempt(value=>value+1)}>Повторить</button></div>:readers===null?<p role="status">Загрузка…</p>:readers.length?<ul>{readers.map(reader=>{const user=state.users.find(user=>user.id===reader.user);return <li key={reader.user}><UserAvatar user={user||{id:reader.user,name:'Пользователь'}} size="sm" presence={false} decoration={user?.decorations?.avatar}/><div><strong>{user?.name||'Пользователь'}</strong><time dateTime={new Date(reader.seenAt*1000).toISOString()}>{new Date(reader.seenAt*1000).toLocaleString('ru',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</time></div></li>})}</ul>:<p>Пока никто не посмотрел.</p>}
 </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
