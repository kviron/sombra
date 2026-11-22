import {useEffect,useRef,useState} from 'react';
import {Dialog as RadixDialog} from 'radix-ui';
import {Link2} from 'lucide-react';
import {Button} from '@/shared/ui/button';
import {Input} from '@/shared/ui/input';
import {normalizeLinkUrl} from '@/shared/lib/message-links';
import './message-link-dialog.css';

type Selection={channel:string;draft:string;start:number;end:number};

export function useMessageLink({channel,draft,setDraft,disabled=false}:{channel:string;draft:string;setDraft:(text:string)=>void;disabled?:boolean}){
 const textareaRef=useRef<HTMLTextAreaElement>(null);
 const latest=useRef({channel,draft,setDraft,disabled});latest.current={channel,draft,setDraft,disabled};
 const [selection,setSelection]=useState<Selection|null>(null);
 const [label,setLabel]=useState(''),[url,setUrl]=useState(''),[error,setError]=useState('');
 const focusPosition=useRef<number|null>(null);
 function close(){setSelection(null);setError('');}
 useEffect(()=>{
  function keydown(event:KeyboardEvent){
   if(!(event.ctrlKey||event.metaKey)||event.altKey||event.key.toLowerCase()!=='k')return;
   const current=latest.current;
   if(!current.channel||current.disabled)return;
   const target=event.target as HTMLElement|null;
   if(target?.closest('[role="dialog"]'))return;
   if(target!==textareaRef.current&&(target?.matches('input,textarea')||target?.isContentEditable))return;
   event.preventDefault();event.stopPropagation();
   const textarea=textareaRef.current;
   const focused=document.activeElement===textarea;
   const start=focused?textarea?.selectionStart??current.draft.length:current.draft.length;
   const end=focused?textarea?.selectionEnd??start:start;
   const text=current.draft.slice(start,end).replace(/[\r\n]+/g,' ');
   setSelection({channel:current.channel,draft:current.draft,start,end});
   setLabel(text);setUrl(normalizeLinkUrl(text)||'');setError('');focusPosition.current=null;
  }
  window.addEventListener('keydown',keydown,true);
  return()=>window.removeEventListener('keydown',keydown,true);
 },[]);
 useEffect(()=>{if(selection&&(selection.channel!==channel||disabled))close()},[channel,disabled,selection]);
 function submit(){
  if(!selection||selection.channel!==channel||latest.current.draft!==selection.draft){setError('Черновик изменился. Закройте окно и создайте ссылку заново.');return}
  const value=url.trim();
  const candidate=/^[a-z][a-z\d+.-]*:/i.test(value)?value:/^[^\s/]+\.[^\s/]+(?:[/?#].*)?$/.test(value)?`https://${value}`:'';
  const href=value?normalizeLinkUrl(candidate):null;
  if(!href){setError('Укажите корректный http:// или https:// адрес без логина и пароля.');return}
  const text=(label.trim()||new URL(href).hostname).replace(/\\/g,'\\\\').replace(/\[/g,'\\[').replace(/\]/g,'\\]');
  const encoded=href.replace(/\(/g,'%28').replace(/\)/g,'%29');
  const markup=`[${text}](${encoded})`;
  const before=selection.draft.slice(0,selection.start),after=selection.draft.slice(selection.end);
  const padding=selection.start===selection.end&&selection.end===selection.draft.length&&before&&!/\s$/.test(before)?' ':'';
  const result=before+padding+markup+after;
  if(result.length>2000){setError('Со ссылкой сообщение превысит лимит 2000 символов.');return}
  latest.current.setDraft(result);
  focusPosition.current=before.length+padding.length+markup.length;
  close();
 }
 const dialog=<RadixDialog.Root open={!!selection} onOpenChange={open=>{if(!open)close()}}><RadixDialog.Portal><RadixDialog.Overlay className="message-link-overlay"/><RadixDialog.Content className="message-link-dialog" onCloseAutoFocus={event=>{event.preventDefault();requestAnimationFrame(()=>{const textarea=textareaRef.current;textarea?.focus();if(focusPosition.current!==null)textarea?.setSelectionRange(focusPosition.current,focusPosition.current)})}}>
  <RadixDialog.Title><Link2 size={18}/>Создать ссылку</RadixDialog.Title>
  <RadixDialog.Description className="message-link-description">Ссылка будет вставлена в черновик. Сообщение не отправится автоматически.</RadixDialog.Description>
  <form onSubmit={event=>{event.preventDefault();event.stopPropagation();submit()}}>
   <label htmlFor="message-link-label">Текст<Input id="message-link-label" autoFocus value={label} onChange={event=>{setLabel(event.target.value);setError('')}} maxLength={2000} placeholder="Например, OpenAI Help Center"/></label>
   <label htmlFor="message-link-url">URL<Input id="message-link-url" value={url} onChange={event=>{setUrl(event.target.value);setError('')}} maxLength={2000} inputMode="url" autoComplete="off" spellCheck={false} placeholder="https://help.openai.com"/></label>
   {error&&<p role="alert" className="message-link-error">{error}</p>}
   <footer><Button type="button" variant="ghost" onClick={close}>Отмена</Button><Button type="submit" disabled={!url.trim()}>Создать</Button></footer>
  </form>
 </RadixDialog.Content></RadixDialog.Portal></RadixDialog.Root>;
 return {textareaRef,dialog};
}
