import {useRef,useState} from 'react';
import {Check,CheckCheck,Eye,Forward,Pencil,Copy,Trash2,Reply} from 'lucide-react';
import {ContextMenu} from 'radix-ui';
import {toast} from 'sonner';
import {type ChatState,type ChatMessage} from '@/shared/types';
import {EntityContextMenu} from '@/shared/ui/entity-context-menu';
import {Message,MessageAvatar,MessageContent,MessageHeader,MessageFooter,Bubble,BubbleContent} from '@/shared/ui/message';
import {UserAvatar} from '@/shared/ui/user-avatar';
import {canGroup} from '@/entities/group';
import {MessageActionDialog} from '@/features/message-actions';
import {MessageReadersDialog} from '@/features/message-actions';
import {MessageQuote} from '@/features/message-actions';
import {SentSticker} from '@/entities/sticker';
import {MessageAttachment,MessageText,messageService} from '@/entities/message';
import {useUserActions} from '@/shared/lib/user-actions';
import './messages.css';

export const emojis=['👍','❤️','😂','🔥','🎉','👀'];
export function MessageItem({message:m,previous,state,refresh,onError,userName,onReply,onForward,onJump}:{message:ChatMessage;previous?:ChatMessage;userName:(id:string)=>string;onReply?:(message:ChatMessage)=>void;onForward?:(message:ChatMessage)=>void;onJump?:(id:string)=>void}&{state:ChatState;refresh:()=>Promise<unknown>;onError:(message:string)=>void}){
 const [busy,setBusy]=useState(false);
 const [dialog,setDialog]=useState<'edit'|'delete'>();
 const [readersOpen,setReadersOpen]=useState(false);
 const userActions=useUserActions();
 const row=useRef<HTMLElement>(null);
 const grouped=!!previous&&m.time-previous.time>=0&&m.time-previous.time<=300&&previous.channel===m.channel&&previous.user===m.user&&previous.bot_name===m.bot_name&&new Date(previous.time*1000).toDateString()===new Date(m.time*1000).toDateString();
 const sticker=state.stickers?.find(s=>s.id===m.sticker);
 const author=m.user===state.me.id&&!m.bot_name;
 const messageGroup=state.groups.find(group=>group.channels.some(channel=>channel.id===m.channel));
 const canDeleteEveryone=author||!!messageGroup?.permissions&&canGroup(messageGroup,state.me.id,'messages.delete_any');
 const identity=state.users.find(u=>u.id===m.user);
 const avatar=identity?.avatar;
 const name=identity?.name||m.bot_name||userName(m.user);
 const canOpenProfile=!!identity;
 const openProfile=()=>{if(canOpenProfile)userActions?.openProfile(m.user)};
 const hasText=!!m.text?.trim();
 const hasImage=!!m.attachment&&['image/gif','image/png','image/jpeg','image/webp'].includes(m.attachment.mime);
 const reactionEmojis=emojis.filter(emoji=>m.reactions?.some(reaction=>reaction.emoji===emoji));
 async function react(emoji:string){
  if(busy)return;
  setBusy(true);
  try{await messageService.react({message:m.id,emoji});await refresh()}
  catch(e){onError((e as Error).message)}
  finally{setBusy(false)}
 }
 async function copyText(){
  try{await navigator.clipboard.writeText(m.text);toast.success('Текст скопирован')}
  catch{onError('Не удалось скопировать текст сообщения')}
 }
 const reactionMenu=<ContextMenu.Group aria-label="Реакции" className="flex justify-between gap-1 px-1 py-1">
  {emojis.map(emoji=><ContextMenu.Item key={emoji} disabled={busy} aria-label={'Реакция '+emoji}
   onSelect={()=>void react(emoji)}
   className="grid size-8 cursor-default place-items-center rounded-sm text-base outline-none select-none data-[highlighted]:bg-accent data-[disabled]:opacity-50"
  >{emoji}</ContextMenu.Item>)}
 </ContextMenu.Group>;
 const read=state.readReceiptsSupported===true&&author&&(m.readCount||0)>0;
 const actions=[
  ...(onReply?[{label:'Ответить',icon:Reply,onSelect:()=>onReply(m)}]:[]),
  ...(onForward&&!m.attachment&&!m.sticker&&!m.gif&&hasText?[{label:'Переслать',icon:Forward,onSelect:()=>onForward(m)}]:[]),
  ...(state.readReceiptsSupported&&author?[{label:read?`Посмотрели: ${m.readCount}`:'Пока не просмотрено',icon:Eye,disabled:!read,onSelect:()=>setReadersOpen(true)}]:[]),
  ...(author&&hasText&&!m.forwardedFrom?[{label:'Редактировать',icon:Pencil,onSelect:()=>setDialog('edit')}]:[]),
  ...(hasText?[{label:'Копировать текст',icon:Copy,onSelect:()=>void copyText()}]:[]),
  {label:'Удалить сообщение',icon:Trash2,onSelect:()=>setDialog('delete')},
 ];
 return <>
  <EntityContextMenu controls={reactionMenu} actions={actions}>
   <Message ref={row} data-read-message-id={m.id} data-message-id={m.id} data-grouped={grouped} data-own={author} aria-label={name} align="start" tabIndex={0}
    className="rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
    <MessageAvatar>{canOpenProfile?<button type="button" className="avatar-trigger" title={`Профиль ${name}`} onClick={openProfile}>{identity?<UserAvatar user={identity} size="md" presence={false} decorative decoration={grouped?undefined:identity.decorations?.avatar}/>:avatar?<img src={avatar} alt=""/>:name[0]}</button>:avatar?<img src={avatar} alt=""/>:name[0]}</MessageAvatar>
    <MessageContent>
     <Bubble data-inline-time={hasText&&!m.attachment&&!sticker&&reactionEmojis.length===0} data-sticker-only={!!sticker&&!hasText} data-image-only={hasImage&&!hasText} data-image-message={hasImage}>
      {!grouped&&<MessageHeader><strong>{canOpenProfile?<button type="button" className="message-author" title={`Профиль ${name}`} onClick={openProfile}>{name}</button>:name}</strong>{(m.bot_name||identity?.bot)&&<small className="bot-badge">БОТ</small>}</MessageHeader>}
      {m.replyTo&&<MessageQuote reply={m.replyTo} userName={userName} onJump={onJump?()=>onJump(m.replyTo!.id):undefined}/>}
       {m.forwardedFrom&&<div className="message-forwarded"><Forward size={14} aria-hidden="true"/>Переслано от {userName(m.forwardedFrom.author)}</div>}
       <BubbleContent>{m.text&&(hasImage?<div className="message-image-caption"><MessageText text={m.text} mentions={m.mentions}/></div>:<MessageText text={m.text} mentions={m.mentions}/>)}{sticker&&<SentSticker key={sticker.id} sticker={sticker} user={state.me.id} catalog={state.stickerCatalogSupported} refresh={refresh}/>}{m.attachment&&<MessageAttachment messageId={m.id} attachment={m.attachment}/>}</BubbleContent>
      <div className={reactionEmojis.length?'message-bottom-row':'message-bottom-inline'}>
       {reactionEmojis.length>0&&<div className="reactions">{reactionEmojis.map(emoji=><button
        type="button" disabled={busy} aria-label={`Реакция ${emoji}`} aria-pressed={m.reactions?.some(reaction=>reaction.emoji===emoji&&reaction.user===state.me.id)}
        key={emoji} onClick={()=>void react(emoji)}
       >{emoji} {m.reactions?.filter(reaction=>reaction.emoji===emoji).length}</button>)}</div>}
      <MessageFooter>
       <time dateTime={new Date(m.time*1000).toISOString()}>{new Date(m.time*1000).toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'})}</time>
       {author&&(read?<button type="button" className="message-read-check" aria-label="Просмотрено" title={`Посмотрели: ${m.readCount}${m.readAt?' · '+new Date(m.readAt*1000).toLocaleString('ru'):''}`} onClick={()=>setReadersOpen(true)}><CheckCheck size={13}/></button>:<Check size={13} aria-label="Отправлено"/>)}
      </MessageFooter>
      </div>
     </Bubble>
    </MessageContent>
   </Message>
  </EntityContextMenu>
  {readersOpen&&read&&<MessageReadersDialog state={state} message={m} trigger={row} onClose={()=>setReadersOpen(false)}/>}
   {dialog&&<MessageActionDialog mode={dialog} message={m} author={author} canDeleteEveryone={canDeleteEveryone} trigger={row} refresh={refresh} onClose={()=>setDialog(undefined)}/>}
 </>;
}
