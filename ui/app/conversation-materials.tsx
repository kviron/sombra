import {useEffect,useMemo,useRef,useState} from 'react';
import {Dialog} from 'radix-ui';
import {ArrowLeft,ArrowUpRight,ChevronRight,File,Headphones,Image,Link2,Maximize2,Search,Video,X} from 'lucide-react';
import type {ChatMessage} from '@/shared/api/backend';
import {conversationMaterials,filterMaterials,type MaterialCategory,type ConversationMaterial} from '@/shared/lib/conversation-materials';
import {MessageAttachment} from './message-attachments';
import {handleMessageLinkClick} from './message-text';
import './conversation-materials.css';
const categories=[{id:'photos',label:'Фото',icon:Image},{id:'videos',label:'Видео',icon:Video},{id:'files',label:'Файлы',icon:File},{id:'audio',label:'Аудио',icon:Headphones},{id:'links',label:'Ссылки',icon:Link2}] as const;
const month=(time:number)=>new Date(time*1000).toLocaleDateString('ru',{month:'long',year:'numeric'});
const date=(time:number)=>new Date(time*1000).toLocaleDateString('ru',{day:'numeric',month:'short'});
export function ConversationMaterials({channel,title,messages,userName,onClose,onJump}:{channel:string;title:string;messages:ChatMessage[];userName:(id:string)=>string;onClose:()=>void;onJump:(id:string)=>void}){
 const [category,setCategory]=useState<MaterialCategory|'all'>('all'),[query,setQuery]=useState(''),[viewer,setViewer]=useState<ConversationMaterial|null>(null);
 const [limit,setLimit]=useState(60);
 const panel=useRef<HTMLElement>(null);
 useEffect(()=>{
  const element=panel.current,body=element?.parentElement,composer=body?.querySelector<HTMLElement>('.composer');
  if(!element||!body||!composer)return;
  const measure=()=>element.style.setProperty('--materials-composer-inset',`${Math.max(0,body.getBoundingClientRect().bottom-composer.getBoundingClientRect().top+8)}px`);
  measure();const observer=new ResizeObserver(measure);observer.observe(body);observer.observe(composer);return()=>observer.disconnect();
 },[]);
 const items=useMemo(()=>conversationMaterials(messages,channel),[messages,channel]);
 const filtered=filterMaterials(items,category,query,userName);
 const counts=Object.fromEntries(categories.map(item=>[item.id,items.filter(material=>material.category===item.id).length]));
 const grouped=new Map<string,ConversationMaterial[]>();
 for(const item of filtered.slice(0,limit)){const key=month(item.message.time);const group=grouped.get(key);if(group)group.push(item);else grouped.set(key,[item])}
 const overview=category==='all'&&!query.trim();
 const label=categories.find(item=>item.id===category)?.label||'Материалы чата';
 useEffect(()=>{function escape(event:KeyboardEvent){if(event.key==='Escape'&&!event.defaultPrevented&&!viewer&&!document.querySelector('[role="dialog"][aria-modal="true"]'))onClose()}window.addEventListener('keydown',escape);return()=>window.removeEventListener('keydown',escape)},[onClose,viewer]);
 function jump(item:ConversationMaterial){setViewer(null);onJump(item.message.id)}
 return <aside ref={panel} id="conversation-materials" className="conversation-materials" aria-label="Материалы переписки">
  <header className="materials-heading">{category!=='all'&&<button type="button" aria-label="Все материалы" onClick={()=>{setCategory('all');setLimit(60)}}><ArrowLeft size={18}/></button>}<div><h2>{label}</h2><p title={title}>{title}</p></div><button type="button" aria-label="Закрыть материалы" title="Закрыть панель" onClick={onClose}><X size={18}/></button></header>
  <label className="materials-search"><Search size={16}/><input aria-label="Поиск материалов переписки" placeholder="Название, ссылка или автор" value={query} onChange={event=>{setQuery(event.target.value);setLimit(60)}}/>{query&&<button type="button" aria-label="Очистить поиск материалов" onClick={()=>setQuery('')}><X size={14}/></button>}</label>
  <div className="materials-content">
   {overview?<><nav className="materials-categories" aria-label="Категории материалов">{categories.map(({id,label,icon:Icon})=><button key={id} type="button" onClick={()=>{setCategory(id);setLimit(60)}}><Icon size={20}/><span>{label}</span><small>{counts[id]}</small><ChevronRight size={16}/></button>)}</nav><div className="materials-summary"><Link2 size={24}/><p>Вложения и ссылки этой переписки — в одном месте.</p><span>{items.length?'Выберите категорию или воспользуйтесь поиском.':'Пока здесь нет материалов. Они появятся после отправки вложения или ссылки.'}</span></div></>:<>
    <p className="materials-results" role="status">{filtered.length?`Найдено: ${filtered.length}`:query?'Ничего не найдено':'В этой категории пока пусто'}</p>
    {[...grouped].map(([monthLabel,entries])=><section className="materials-month-group" key={monthLabel}><h3 className="materials-month">{monthLabel}</h3><div className={category==='photos'?'materials-photo-grid':'materials-list'}>{entries.map(item=><article key={item.id} className="material-card" data-material-id={item.id} data-category={item.category} data-expired={item.message.attachment?.expired||undefined}>
      {item.href?<div className="material-link"><div className="material-link-symbol"><Link2 size={19}/></div><div><a href={item.href} target="_blank" rel="noopener noreferrer" onClick={handleMessageLinkClick} onAuxClick={handleMessageLinkClick}>{item.title}</a><span>{new URL(item.href).hostname}</span><p>{item.href}</p></div></div>:item.message.attachment&&<><MessageAttachment messageId={item.message.id} attachment={item.message.attachment}/>{item.category==='photos'&&!item.message.attachment.expired&&<button type="button" className="material-expand" title="Открыть фото" aria-label={`Открыть фото ${item.title}`} onClick={()=>setViewer(item)}><Maximize2 size={16}/></button>}</>}
      <footer className="material-caption"><span title={userName(item.message.user)}>{userName(item.message.user)} · {date(item.message.time)}</span><button type="button" title="Перейти к сообщению" aria-label={`Перейти к сообщению: ${item.title}`} onClick={()=>jump(item)}><ArrowUpRight size={17}/></button></footer>
     </article>)}</div></section>)}
    {filtered.length>limit&&<button type="button" className="materials-load-more" onClick={()=>setLimit(value=>value+60)}>Показать ещё · {filtered.length-limit}</button>}
   </>}
  </div>
  <Dialog.Root open={!!viewer} onOpenChange={open=>{if(!open)setViewer(null)}}><Dialog.Portal><Dialog.Overlay className="material-viewer-overlay"/><Dialog.Content className="material-viewer"><div className="material-viewer-heading"><Dialog.Title>{viewer?.title||'Фотография'}</Dialog.Title><Dialog.Close asChild><button type="button" aria-label="Закрыть просмотр фото"><X size={20}/></button></Dialog.Close></div><Dialog.Description>Фотография из переписки «{title}».</Dialog.Description>{viewer?.message.attachment&&<MessageAttachment messageId={viewer.message.id} attachment={viewer.message.attachment}/>}<button type="button" className="material-viewer-source" onClick={()=>viewer&&jump(viewer)}>Перейти к сообщению <ArrowUpRight size={16}/></button></Dialog.Content></Dialog.Portal></Dialog.Root>
 </aside>;
}
