import {useRef,useState} from 'react';
import {Smile, Sticker as StickerIcon, X, MessageCircle, UserPlus, Check, Bot as BotIcon, Copy, Pencil, Trash2} from 'lucide-react';
import {ContextMenu} from 'radix-ui';
import {toast} from 'sonner';
import {api, type ChatState, type ChatMessage} from '@/shared/api/backend';
import {EntityContextMenu} from '@/shared/ui/entity-context-menu';
import {Message,MessageAvatar,MessageContent,MessageHeader,MessageFooter,Bubble,BubbleContent} from '@/shared/ui/message';
import {MessageActionDialog} from './message-action-dialog';
import {useUserActions} from './user-actions';
import './messages.css';
import emojiData from '@emoji-mart/data/sets/15/native.json';
import {StickerImage} from './sticker-library';
import {MessageAttachment} from './message-attachments';
export const emojis=['👍','❤️','😂','🔥','🎉','👀'];
type Common={state:ChatState;refresh:()=>Promise<unknown>;onError:(message:string)=>void};
export function MessageItem({message:m,previous,state,refresh,onError,userName}:{message:ChatMessage;previous?:ChatMessage;userName:(id:string)=>string}&Common){
 const [busy,setBusy]=useState(false);
 const [dialog,setDialog]=useState<'edit'|'delete'>();
 const userActions=useUserActions();
 const row=useRef<HTMLElement>(null);
 const grouped=!!previous&&previous.channel===m.channel&&previous.user===m.user&&previous.bot_name===m.bot_name&&new Date(previous.time*1000).toDateString()===new Date(m.time*1000).toDateString();
 const sticker=state.stickers?.find(s=>s.id===m.sticker);
 const author=m.user===state.me.id&&!m.bot_name;
 const avatar=!m.bot_name&&state.users.find(u=>u.id===m.user)?.avatar;
 const name=m.bot_name||userName(m.user);
 const canOpenProfile=!m.bot_name&&state.users.some(user=>user.id===m.user);
 const openProfile=()=>{if(canOpenProfile)userActions?.openProfile(m.user)};
 const hasText=!!m.text?.trim();
 const reactionEmojis=emojis.filter(emoji=>m.reactions?.some(reaction=>reaction.emoji===emoji));
 async function react(emoji:string){
  if(busy)return;
  setBusy(true);
  try{await api('reaction',{message:m.id,emoji});await refresh()}
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
 const actions=[
  ...(author&&hasText?[{label:'Редактировать',icon:Pencil,onSelect:()=>setDialog('edit')}]:[]),
  ...(hasText?[{label:'Копировать текст',icon:Copy,onSelect:()=>void copyText()}]:[]),
  {label:'Удалить сообщение',icon:Trash2,onSelect:()=>setDialog('delete')},
 ];
 return <>
  <EntityContextMenu controls={reactionMenu} actions={actions}>
   <Message ref={row} data-message-id={m.id} data-grouped={grouped} data-own={author} aria-label={name} align="start" tabIndex={0}
    className="rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
    <MessageAvatar>{canOpenProfile?<button type="button" className="avatar-trigger" title={`Профиль ${name}`} onClick={openProfile}>{avatar?<img src={avatar} alt=""/>:name[0]}</button>:avatar?<img src={avatar} alt=""/>:name[0]}</MessageAvatar>
    <MessageContent>
     <Bubble data-sticker-only={!!sticker&&!hasText}>
      {!grouped&&<MessageHeader><strong>{canOpenProfile?<button type="button" className="message-author" title={`Профиль ${name}`} onClick={openProfile}>{name}</button>:name}</strong>{m.bot_name&&<small className="bot-badge">БОТ</small>}</MessageHeader>}
      <BubbleContent>{m.text&&<p>{m.text}</p>}{sticker&&<StickerImage key={sticker.id} className="sent-sticker" sticker={sticker}/ >}{m.attachment&&<MessageAttachment messageId={m.id} attachment={m.attachment}/>}</BubbleContent>
      <div className={reactionEmojis.length?'message-bottom-row':'message-bottom-inline'}>
       {reactionEmojis.length>0&&<div className="reactions">{reactionEmojis.map(emoji=><button
        type="button" disabled={busy} aria-label={`Реакция ${emoji}`} aria-pressed={m.reactions?.some(reaction=>reaction.emoji===emoji&&reaction.user===state.me.id)}
        key={emoji} onClick={()=>void react(emoji)}
       >{emoji} {m.reactions?.filter(reaction=>reaction.emoji===emoji).length}</button>)}</div>}
      <MessageFooter>
       <time dateTime={new Date(m.time*1000).toISOString()}>{new Date(m.time*1000).toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'})}</time>
       {author&&<Check size={13} aria-label="Отправлено"/>}
      </MessageFooter>
      </div>
     </Bubble>
    </MessageContent>
   </Message>
  </EntityContextMenu>
  {dialog&&<MessageActionDialog mode={dialog} message={m} author={author} trigger={row} refresh={refresh} onClose={()=>setDialog(undefined)}/>}
 </>;
}
const categories:Record<string,string>={people:'Люди',nature:'Природа',foods:'Еда',activity:'Занятия',places:'Места',objects:'Предметы',symbols:'Символы',flags:'Флаги'};
const emojiById=emojiData.emojis as Record<string,{name:string;keywords?:string[];skins:{native:string}[]}>;
type Panel='emoji'|'stickers';
export function ExpressionPicker({state,onError,onEmoji,onSticker,disabled,group,onManage}:{onEmoji:(emoji:string)=>void;onSticker:(id:string)=>Promise<void>;disabled:boolean;group?:{id:string;owner:string};onManage:(scope:'personal'|'group')=>void}&Common){
 const [panel,setPanel]=useState<Panel>();
 const [busy,setBusy]=useState(false),[category,setCategory]=useState('people'),[query,setQuery]=useState('');
 const [scope,setScope]=useState<'personal'|'group'>('personal'),[pack,setPack]=useState('');
 const library=state.stickers.filter(sticker=>!sticker.archived&&(scope==='group'?!!group&&sticker.group===group.id:!sticker.group&&sticker.owner===state.me.id));
 const packs=[...new Set(library.map(sticker=>sticker.pack||''))];
 const filtered=library.filter(sticker=>!pack||sticker.pack===pack);
 const search=query.trim().toLowerCase();
 const emojiIds=search
  ?Object.keys(emojiById).filter(id=>{const item=emojiById[id];return [item.name,id,...item.keywords||[],item.skins[0]?.native].some(value=>value?.toLowerCase().includes(search))})
  :emojiData.categories.find(item=>item.id===category)?.emojis||[];
 function toggle(next:Panel){setPanel(panel===next?undefined:next)}
 async function sendSticker(id:string){
  setBusy(true);
  try{await onSticker(id);setPanel(undefined)}
  catch(e){onError((e as Error).message)}
  finally{setBusy(false)}
 }
 return <div className="expression-control">
  <button type="button" title="Эмодзи" disabled={disabled} aria-expanded={panel==='emoji'} onClick={()=>toggle('emoji')}><Smile size={20}/></button>
  <button type="button" title="Стикеры" disabled={disabled} aria-expanded={panel==='stickers'} onClick={()=>toggle('stickers')}><StickerIcon size={20}/></button>
  {panel&&<section className="expression-panel" aria-label="Эмодзи и стикеры">
   <header><nav className="expression-tabs" aria-label="Тип вложения">
    <button type="button" aria-pressed={panel==='emoji'} onClick={()=>setPanel('emoji')}>Эмодзи</button>
    <button type="button" aria-pressed={panel==='stickers'} onClick={()=>setPanel('stickers')}>Стикеры</button>
   </nav><button type="button" title="Закрыть панель" onClick={()=>setPanel(undefined)}><X size={16}/></button></header>
   {panel==='emoji'?<>
    <div className="expression-filters"><input aria-label="Поиск эмодзи" placeholder="Поиск эмодзи" value={query} onKeyDown={event=>{if(event.key==='Enter')event.preventDefault()}} onChange={event=>setQuery(event.target.value)}/>
     <select aria-label="Категория эмодзи" value={category} onChange={event=>{setCategory(event.target.value);setQuery('')}}>
      {emojiData.categories.map(item=><option key={item.id} value={item.id}>{categories[item.id]||item.id}</option>)}
     </select>
    </div>
    <div className="emoji-grid" key={category}>{emojiIds.map(id=>{
     const item=emojiById[id],emoji=item?.skins[0]?.native;
     return emoji&&<button key={id} type="button" title={item.name} onClick={()=>{onEmoji(emoji);setPanel(undefined)}}>{emoji}</button>;
    })}</div>
    {!emojiIds.length&&<p>Эмодзи не найдены.</p>}
   </>:<>
    {group&&<nav className="expression-tabs sticker-scopes" aria-label="Библиотека стикеров">
     <button type="button" aria-pressed={scope==='personal'} onClick={()=>{setScope('personal');setPack('')}}>Мои стикеры</button>
     <button type="button" aria-pressed={scope==='group'} onClick={()=>{setScope('group');setPack('')}}>Стикеры группы</button>
    </nav>}
    {packs.length>1&&<select aria-label="Набор стикеров" value={pack} onChange={event=>setPack(event.target.value)}>
     <option value="">Все наборы</option>{packs.filter(Boolean).map(name=><option key={name}>{name}</option>)}
    </select>}
    {filtered.length?<div className="sticker-grid">{filtered.map(sticker=><button type="button" key={sticker.id} disabled={disabled||busy} title={sticker.name} onClick={()=>void sendSticker(sticker.id)}><StickerImage sticker={sticker}/></button>)}</div>:<p>Пока нет стикеров.</p>}
    {(scope==='personal'||group?.owner===state.me.id)&&<button type="button" className="manage-stickers" onClick={()=>{setPanel(undefined);onManage(scope)}}>Управлять стикерами</button>}
   </>}
  </section>}
 </div>;
}
export function Friends({state,refresh,onError,onDialog}:Common&{onDialog:(id:string)=>void}){
 const [tab,setTab]=useState('all'),[query,setQuery]=useState(''),[busy,setBusy]=useState(false);
 async function act(op:string,data:Record<string,unknown>){setBusy(true);try{const result=await api(op,data);await refresh();if(op==='create_dialog')onDialog(result.id)}catch(e){onError((e as Error).message)}finally{setBusy(false)}}
 const friends=state.friends||[];
 const users=state.users.filter(u=>u.id!==state.me.id&&u.name.toLowerCase().includes(query.toLowerCase())).filter(u=>{const f=friends.find(f=>f.from===u.id||f.to===u.id);return tab==='add'?!f:tab==='pending'?f&&!f.accepted:f?.accepted});
 return <section className="friends-page"><nav aria-label="Список друзей">{[['all','Все друзья'],['pending','Заявки'],['add','Добавить друга']].map(([id,label])=><button key={id} aria-pressed={tab===id} onClick={()=>setTab(id)}>{id==='add'&&<UserPlus size={16}/ >}{label}{id==='pending'&&friends.filter(f=>!f.accepted&&f.to===state.me.id).length>0&&<small>{friends.filter(f=>!f.accepted&&f.to===state.me.id).length}</small>}</button>)}</nav><input className="friend-search" aria-label="Найти человека" placeholder="Поиск по имени" value={query} onChange={e=>setQuery(e.target.value)}/><p className="friends-count">{tab==='pending'?'Ожидают ответа':tab==='add'?'Люди в Sombra':'Ваши друзья'} · {users.length}</p>{users.map(u=>{const f=friends.find(f=>f.from===u.id||f.to===u.id);return <div className="friend-row" key={u.id}><div className="avatar">{u.avatar?<img src={u.avatar} alt=""/>:u.name[0]}</div><div><strong>{u.name}</strong><small>{f&&!f.accepted?(f.from===state.me.id?'Заявка отправлена':'Хочет добавить вас в друзья'):u.bio||'Пользователь Sombra'}</small></div><div className="friend-actions">{!f?<button disabled={busy} title="Отправить заявку" onClick={()=>void act('friend_request',{user:u.id})}><UserPlus size={19}/></button>:f.accepted?<><button disabled={busy} title="Написать" onClick={()=>void act('create_dialog',{members:[u.id],name:u.name})}><MessageCircle size={19}/></button><button disabled={busy} title="Удалить из друзей" onClick={()=>void act('friend_remove',{id:f.id})}><X size={16}/></button></>:<>{f.to===state.me.id&&<button title="Принять заявку" disabled={busy} onClick={()=>void act('friend_accept',{id:f.id})}><Check size={19}/></button>}<button title="Отклонить или отменить заявку" disabled={busy} onClick={()=>void act('friend_remove',{id:f.id})}><X size={19}/></button></>}</div></div>})}{!users.length&&<div className="friends-empty"><UserPlus size={36}/><h2>{tab==='pending'?'Новых заявок пока нет':tab==='add'?'Никого не нашли':'Здесь будут ваши друзья'}</h2><p>{tab==='all'?'Добавьте знакомых, чтобы быстро начинать разговор.':'Попробуйте поискать по имени или загляните позже.'}</p>{tab==='all'&&<button className="small-button" onClick={()=>setTab('add')}>Добавить друга</button>}</div>}</section>
}
export function Bots({state,refresh,onError,channel,owner}:Common&{channel:string;owner:boolean}){
 const [name,setName]=useState(''),[token,setToken]=useState(''),[busy,setBusy]=useState(false),[copied,setCopied]=useState(false);
 async function create(){setBusy(true);try{const r=await api('create_bot',{channel,name});setToken(r.token);setCopied(false);setName('');await refresh()}catch(e){onError((e as Error).message)}finally{setBusy(false)}}
 return <section className="bot-settings"><BotIcon size={28}/><h3>Боты в этой комнате</h3><p>Подключите своего помощника: он сможет читать сообщения и отвечать только в этой комнате. ИИ работает через отдельный сервис вашего бота.</p>{state.bots?.filter(b=>b.channel===channel).map(b=><div className="friend-row" key={b.id}><BotIcon size={20}/><strong>{b.name}</strong>{owner&&<button type="button" title="Отключить бота" onClick={()=>{void api('delete_bot',{id:b.id}).then(refresh).catch(e=>onError(e.message))}}><Trash2 size={16}/></button>}</div>)}{owner&&<><label>Имя помощника<input aria-label="Имя бота" maxLength={32} value={name} onChange={e=>setName(e.target.value)} placeholder="Например, Помощник команды"/></label><button type="button" className="small-button" disabled={busy||!name.trim()} onClick={()=>void create()}>Создать подключение</button>{token&&<div className="bot-token"><p>Скопируйте ключ сейчас — повторно он не показывается. Передайте его только своему сервису бота.</p><input aria-label="Ключ бота" readOnly value={token}/><button type="button" className="small-button" onClick={()=>void navigator.clipboard.writeText(token).then(()=>setCopied(true)).catch(()=>onError('Скопируйте ключ из поля вручную.'))}><Copy size={16}/>{copied?'Скопировано':'Скопировать ключ'}</button></div>}<p className="bot-help">Передайте ключ разработчику вашего бота. Отключить доступ можно здесь в любой момент.</p></>}</section>
}
