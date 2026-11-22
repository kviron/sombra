import {useState} from 'react';
import {Dialog} from 'radix-ui';
import {Forward,Hash,MessageCircle,Reply,Search,Volume2,X} from 'lucide-react';
import type {ChatMessage,MessageReply} from '@/shared/types';
import './message-references.css';

export type ForwardDestination={id:string;name:string;group?:{id:string;name:string};voice?:boolean;keywords?:string};
export function messagePreview(message:ChatMessage){
 return message.text?.trim()||message.attachment?.name||(message.sticker?'Стикер':message.gif?'GIF':'Сообщение');
}
export function MessageQuote({reply,userName,onJump}:{reply:MessageReply;userName:(id:string)=>string;onJump?:()=>void}){
 if(!reply.author)return <div className="message-reference"><Reply size={15} aria-hidden="true"/>Исходное сообщение недоступно</div>;
 const content=<><Reply size={15} aria-hidden="true"/><span><strong>{userName(reply.author)}</strong><small>{reply.text||'Сообщение без текста'}</small></span></>;
 return onJump?<button type="button" className="message-reference" title="Перейти к исходному сообщению" onClick={onJump}>{content}</button>:<div className="message-reference">{content}</div>;
}
export function ReferenceDraft({kind,message,author,onCancel,disabled}:{kind:'reply'|'forward';message:ChatMessage;author:string;onCancel:()=>void;disabled?:boolean}){
 const Icon=kind==='reply'?Reply:Forward;
 return <div className="reference-draft"><Icon size={17} aria-hidden="true"/><span><strong>{kind==='reply'?'Ответ':'Пересылка'} · {author}</strong><small>{messagePreview(message)}</small></span><button type="button" title="Отменить" aria-label={kind==='reply'?'Отменить ответ':'Отменить пересылку'} onClick={onCancel} disabled={disabled}><X size={17}/></button></div>;
}
export function ForwardPicker({destinations,onClose,onChoose,source,author}:{destinations:ForwardDestination[];onClose:()=>void;onChoose:(item:ForwardDestination)=>void;source:ChatMessage;author:string}){
 const [query,setQuery]=useState('');
 const matches=destinations.filter(item=>`${item.name} ${item.group?.name||''} ${item.keywords||''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
 return <Dialog.Root open onOpenChange={open=>{if(!open)onClose()}}><Dialog.Portal><Dialog.Overlay className="modal-backdrop"/><Dialog.Content className="group-modal forward-picker dark">
  <header><Dialog.Title>Переслать сообщение</Dialog.Title><Dialog.Close asChild><button type="button" aria-label="Закрыть"><X size={19}/></button></Dialog.Close></header>
  <Dialog.Description asChild><div className="message-reference"><Forward size={15} aria-hidden="true"/><span><strong>{author}</strong><small>{messagePreview(source)}</small></span></div></Dialog.Description>
  <label className="dialog-search"><Search size={17} aria-hidden="true"/><input autoFocus placeholder="Поиск чата или канала" aria-label="Поиск чата или канала" value={query} onChange={event=>setQuery(event.target.value)}/></label>
  <ul aria-label="Куда переслать">{matches.map(item=>{const Icon=item.voice?Volume2:item.group?Hash:MessageCircle;return <li key={item.id}><button type="button" onClick={()=>onChoose(item)}><Icon size={18} aria-hidden="true"/><span><strong>{item.name}</strong><small>{item.group?.name||'Личные сообщения'}</small></span></button></li>})}</ul>
  {!matches.length&&<p role="status">{query.trim()?'Чаты и каналы не найдены.':'Нет доступных чатов и каналов.'}</p>}
 </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
