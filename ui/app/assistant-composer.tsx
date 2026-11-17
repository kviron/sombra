import {useEffect,useMemo,useRef,type FormEvent,type ReactNode,type RefObject,type ClipboardEvent} from 'react';
import {AssistantRuntimeProvider,ComposerPrimitive,useExternalStoreRuntime,type ThreadMessage} from '@assistant-ui/react';
import type {ChatState} from '@/shared/api/backend';
import {composerTrigger,mentionCandidates,commandCandidates,localCommandCandidates} from './composer-candidates';
import '@/shared/ui/menu-material.css';
import './assistant-composer.css';

type Props={state:ChatState;channel:string;group?:string;draft:string;setDraft:(text:string)=>void;onSubmit:(event:FormEvent)=>void;onSearch:()=>void;disabled:boolean;sendDisabled:boolean;hasAttachment:boolean;placeholder:string;textareaRef:RefObject<HTMLTextAreaElement|null>;onPaste:(event:ClipboardEvent<HTMLTextAreaElement>)=>void;children:ReactNode;sendButton:ReactNode};
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
 useEffect(()=>{syncing.current=true;runtime.thread.composer.setText(props.draft);syncing.current=false},[runtime,props.draft]);
 useEffect(()=>runtime.thread.composer.subscribe(()=>{
  if(syncing.current)return;
  const text=runtime.thread.composer.getState().text;
  if(text!==latest.current.draft)latest.current.setDraft(text);
 }),[runtime]);
 const mentions=useMemo(()=>mentionCandidates(props.state,props.channel,props.group),[props.state,props.channel,props.group]);
 const commands=useMemo(()=>[...localCommandCandidates,...commandCandidates(props.state,props.channel,props.group)],[props.state,props.channel,props.group]);
 function adapter(items:typeof mentions){return {categories:()=>[],categoryItems:()=>items,search:(query:string)=>props.disabled||props.sendDisabled?[]:items.filter(item=>String(item.metadata.search).toLocaleLowerCase().split(' ').some(part=>part.startsWith(query.toLocaleLowerCase()))).slice(0,12)}}
 const mentionAdapter=useMemo(()=>adapter(mentions),[mentions,props.disabled,props.sendDisabled]);
 const commandAdapter=useMemo(()=>adapter(commands),[commands,props.disabled,props.sendDisabled]);
 return <AssistantRuntimeProvider runtime={runtime}><ComposerPrimitive.TriggerPopoverRoot><ComposerPrimitive.Root className="composer sombra-assistant-composer" onSubmit={props.onSubmit}>
 <ComposerPrimitive.Input ref={props.textareaRef} rows={1} maxRows={6} maxLength={2000} aria-label="Сообщение" role="combobox" aria-autocomplete="list" placeholder={props.placeholder} cancelOnEscape={false} addAttachmentOnPaste={false} unstable_focusOnRunStart={false} unstable_focusOnScrollToBottom={false} onPaste={props.onPaste}/>
 <div className="sombra-composer-tools">{props.children}<span className="sombra-composer-hint">Enter — отправить</span>{props.hasAttachment&&!props.draft.trim()?props.sendButton:<ComposerPrimitive.Send asChild disabled={props.sendDisabled} onClick={event=>{event.preventDefault();event.currentTarget.closest('form')?.requestSubmit()}}>{props.sendButton}</ComposerPrimitive.Send>}</div>
 <ComposerPrimitive.TriggerPopover char="@" matcher={composerTrigger} adapter={mentionAdapter} className="sombra-composer-menu sombra-menu-surface" data-slot="mention-menu-content" aria-label="Участники чата">
 <ComposerPrimitive.TriggerPopover.Directive formatter={formatter}/><p>Участники чата</p><ComposerPrimitive.TriggerPopoverItems>{items=>items.length?items.map(item=><ComposerPrimitive.TriggerPopoverItem key={item.id} item={item} tabIndex={-1} onMouseDown={e=>e.preventDefault()}><span className="sombra-mention-avatar">{item.metadata?.avatar?<img src={String(item.metadata.avatar)} alt=""/>:item.label.slice(0,1)}</span><span><strong>{item.label}</strong><small>{item.description}</small></span></ComposerPrimitive.TriggerPopoverItem>):<div className="sombra-composer-menu-empty">Нет подходящих участников</div>}</ComposerPrimitive.TriggerPopoverItems>
 </ComposerPrimitive.TriggerPopover>
 <ComposerPrimitive.TriggerPopover char="/" matcher={composerTrigger} adapter={commandAdapter} className="sombra-composer-menu sombra-menu-surface" data-slot="command-menu-content" aria-label="Команды переписки и ботов">
 <ComposerPrimitive.TriggerPopover.Action formatter={formatter} onExecute={item=>{
  if(item.id==='local:clear')runtime.thread.composer.setText('');
  else if(item.id==='local:search'){
   const text=runtime.thread.composer.getState().text;
   runtime.thread.composer.setText(text.startsWith(' ')?text.slice(1):text);
   requestAnimationFrame(()=>latest.current.onSearch());
  }
 }}/><p>Переписка и боты · команды бота вставляются без отправки</p><ComposerPrimitive.TriggerPopoverItems>{items=>items.length?items.map(item=><ComposerPrimitive.TriggerPopoverItem key={item.id} item={item} tabIndex={-1} onMouseDown={e=>e.preventDefault()}><span><strong>{item.label}</strong><small>{item.description}</small></span></ComposerPrimitive.TriggerPopoverItem>):<div className="sombra-composer-menu-empty">В этом чате нет подходящих команд</div>}</ComposerPrimitive.TriggerPopoverItems>
 </ComposerPrimitive.TriggerPopover>
 </ComposerPrimitive.Root></ComposerPrimitive.TriggerPopoverRoot></AssistantRuntimeProvider>;
}
