import {useEffect,useMemo,useRef,type FormEvent,type ReactNode,type RefObject,type ClipboardEvent} from 'react';
import {AssistantRuntimeProvider,ComposerPrimitive,useExternalStoreRuntime,type ThreadMessage} from '@assistant-ui/react';
import type {ChatState} from '@/shared/api/backend';
import {composerTrigger,mentionCandidates,commandCandidates,localCommandCandidates} from './composer-candidates';
import '@/shared/ui/menu-material.css';
import {ComposerToolbar,ComposerActions,paper,composerInputClass} from '@/shared/ui/elements-composer';
import './assistant-composer.css';
import {parseMusicCommand} from './room-music';

const musicCommands=[['play','Добавить трек · вставьте ссылку после команды'],['pause','Поставить музыку на паузу'],['resume','Продолжить воспроизведение'],['skip','Пропустить трек'],['stop','Остановить и очистить очередь']].map(([name,description])=>({id:`music:${name}`,type:'command',label:`/${name}`,description,metadata:{insert:`/${name}`,avatar:'',search:name}}));

type Props={onMentionInserted?:(mention:{userId:string;start:number;end:number},text:string)=>void;state:ChatState;channel:string;group?:string;draft:string;setDraft:(text:string)=>void;onSubmit:(event:FormEvent)=>void;onSearch:()=>void;disabled:boolean;sendDisabled:boolean;hasAttachment:boolean;placeholder:string;textareaRef:RefObject<HTMLTextAreaElement|null>;onPaste:(event:ClipboardEvent<HTMLTextAreaElement>)=>void;children:ReactNode;attachments?:ReactNode;sendButton:ReactNode};
const messages:ThreadMessage[]=[];
const formatter={serialize:(item:{metadata?:Readonly<Record<string,unknown>>})=>String(item.metadata?.insert||''),parse:(text:string)=>[{kind:'text' as const,text}]};

/** A UI-only external-store runtime. Sombra owns drafts, attachments and all sending.
 * Root's preventDefault interception intentionally bypasses runtime.send(), whose
 * optimistic composer reset would otherwise lose drafts after a backend error.
 */
export function AssistantComposer(props:Props){
 const latest=useRef(props);latest.current=props;
 const runtime=useExternalStoreRuntime({messages,isDisabled:props.disabled,isSendDisabled:props.sendDisabled,onNew:async()=>{throw new Error('Sombra owns message submission')}});
 const syncing=useRef(false);
 const pendingMention=useRef<{start:number;token:string}|null>(null);
 const mentionFormatter=useMemo(()=>({...formatter,serialize:(item:{metadata?:Readonly<Record<string,unknown>>})=>{
  const input=latest.current.textareaRef.current,token=String(item.metadata?.insert||'');
  const trigger=input?composerTrigger(input.value,'@',input.selectionStart):null;
  pendingMention.current=trigger?{start:trigger.offset,token}:null;
  return token;
 }}),[]);
 useEffect(()=>{syncing.current=true;runtime.thread.composer.setText(props.draft);syncing.current=false},[runtime,props.draft]);
 useEffect(()=>runtime.thread.composer.subscribe(()=>{
  if(syncing.current)return;
  const text=runtime.thread.composer.getState().text;
  if(text!==latest.current.draft)latest.current.setDraft(text);
 }),[runtime]);
 const mentions=useMemo(()=>mentionCandidates(props.state,props.channel,props.group),[props.state,props.channel,props.group]);
 const roomMusic=props.state.groups.some(group=>group.id===props.group&&group.channels.some(channel=>channel.id===props.channel&&channel.kind==='voice'));
 const commands=useMemo(()=>[...(roomMusic?musicCommands:[]),...localCommandCandidates,...commandCandidates(props.state,props.channel,props.group)],[roomMusic,props.state,props.channel,props.group]);
 function adapter(items:typeof mentions){return {categories:()=>[],categoryItems:()=>items,search:(query:string)=>props.disabled||props.sendDisabled?[]:items.filter(item=>String(item.metadata.search).toLocaleLowerCase().split(' ').some(part=>part.startsWith(query.toLocaleLowerCase()))).slice(0,12)}}
 const mentionAdapter=useMemo(()=>adapter(mentions),[mentions,props.disabled,props.sendDisabled]);
 const commandAdapter=useMemo(()=>adapter(commands),[commands,props.disabled,props.sendDisabled]);
 return <AssistantRuntimeProvider runtime={runtime}><ComposerPrimitive.TriggerPopoverRoot><ComposerPrimitive.Root onKeyDownCapture={event=>{
  if(!roomMusic||props.disabled||props.sendDisabled||event.target!==props.textareaRef.current||event.key!=='Enter'||event.shiftKey||event.ctrlKey||event.altKey||event.metaKey||event.nativeEvent.isComposing||event.keyCode===229)return;
  const command=parseMusicCommand(props.textareaRef.current.value);
  if(!command||(command.action==='add'&&!command.url))return;
  event.preventDefault();event.stopPropagation();event.currentTarget.requestSubmit();
 }} data-slot="composer" className={`${paper} sombra-assistant-composer relative flex w-full flex-col gap-2 rounded-[24px] p-2.5 transition-colors`} onSubmit={props.onSubmit}>
 {props.attachments}<ComposerPrimitive.Input className={composerInputClass} data-slot="composer-input" ref={props.textareaRef} rows={1} maxRows={5} maxLength={2000} aria-label="Сообщение" role="combobox" aria-autocomplete="list" placeholder={props.placeholder} cancelOnEscape={false} addAttachmentOnPaste={false} unstable_focusOnRunStart={false} unstable_focusOnScrollToBottom={false} onPaste={props.onPaste}/>
 <ComposerToolbar><ComposerActions>{props.children}</ComposerActions>{props.hasAttachment&&!props.draft.trim()?props.sendButton:<ComposerPrimitive.Send asChild disabled={props.sendDisabled} onClick={event=>{event.preventDefault();event.currentTarget.closest('form')?.requestSubmit()}}>{props.sendButton}</ComposerPrimitive.Send>}</ComposerToolbar>
 <ComposerPrimitive.TriggerPopover char="@" matcher={composerTrigger} adapter={mentionAdapter} className="sombra-composer-menu sombra-menu-surface" data-slot="mention-menu-content" aria-label="Участники чата">
 <ComposerPrimitive.TriggerPopover.Directive formatter={mentionFormatter} onInserted={item=>{
   const pending=pendingMention.current;pendingMention.current=null;
   const text=runtime.thread.composer.getState().text;
   if(pending&&text.slice(pending.start,pending.start+pending.token.length)===pending.token)latest.current.onMentionInserted?.({userId:item.id,start:pending.start,end:pending.start+pending.token.length},text);
  }}/><ComposerPrimitive.TriggerPopoverItems>{items=><><p>Участники чата</p>{items.length?items.map(item=><ComposerPrimitive.TriggerPopoverItem key={item.id} item={item} tabIndex={-1} onMouseDown={e=>e.preventDefault()}><span className="sombra-mention-avatar">{item.metadata?.avatar?<img src={String(item.metadata.avatar)} alt=""/>:item.label.slice(0,1)}</span><span><strong>{item.label}</strong><small>{item.description}</small></span></ComposerPrimitive.TriggerPopoverItem>):<div className="sombra-composer-menu-empty">Нет подходящих участников</div>}</>}</ComposerPrimitive.TriggerPopoverItems>
 </ComposerPrimitive.TriggerPopover>
 <ComposerPrimitive.TriggerPopover char="/" matcher={composerTrigger} adapter={commandAdapter} className="sombra-composer-menu sombra-menu-surface" data-slot="command-menu-content" aria-label="Команды переписки и ботов">
 <ComposerPrimitive.TriggerPopover.Action formatter={formatter} onExecute={item=>{
  if(item.id==='local:clear')runtime.thread.composer.setText('');
  else if(item.id==='local:search'){
   const text=runtime.thread.composer.getState().text;
   runtime.thread.composer.setText(text.startsWith(' ')?text.slice(1):text);
   requestAnimationFrame(()=>latest.current.onSearch());
  }
 }}/><ComposerPrimitive.TriggerPopoverItems>{items=><><p>Переписка и боты · команды бота вставляются без отправки</p>{items.length?items.map(item=><ComposerPrimitive.TriggerPopoverItem key={item.id} item={item} tabIndex={-1} onMouseDown={e=>e.preventDefault()}><span><strong>{item.label}</strong><small>{item.description}</small></span></ComposerPrimitive.TriggerPopoverItem>):<div className="sombra-composer-menu-empty">В этом чате нет подходящих команд</div>}</>}</ComposerPrimitive.TriggerPopoverItems>
 </ComposerPrimitive.TriggerPopover>
 </ComposerPrimitive.Root></ComposerPrimitive.TriggerPopoverRoot></AssistantRuntimeProvider>;
}
