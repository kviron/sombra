import {useEffect,useId,useRef,useState} from 'react';
import {type Bot,type ChatState} from '@/shared/api/backend';
import {botService} from '../model/services/bot-service';
import './bot-tool-access.css';

type Policy={revision:number;owner:string;users:string[]};
const upgrade='Для настройки инструментов обновите сервер/подключение бота';
const normalized=(users:string[])=>[...new Set(users)].sort();
function policyResponse(value:unknown):Policy{
 const p=value as Policy;
 if(!p||!Number.isSafeInteger(p.revision)||p.revision<0||typeof p.owner!=='string'||!Array.isArray(p.users)||p.users.length>50||p.users.some(id=>typeof id!=='string'))throw new Error('Некорректный ответ настроек доступа.');
 return {...p,users:normalized(p.users.filter(id=>id!==p.owner))};
}
/** Private policy exists only in this mounted, explicitly expanded owner panel. */
export function BotToolAccess({bot,state,rootBusy}:{bot:Bot;state:ChatState;rootBusy:boolean}){
 const [open,setOpen]=useState(false);
 const panelId=useId();
 const actualOwner=!state.me.bot&&bot.owner===state.me.id;
 useEffect(()=>{setOpen(false)},[bot.id,bot.owner,state.me.id,actualOwner]);
 if(!actualOwner)return null;
 return <div className="bot-tool-access">
  <button type="button" className="bot-tool-access-toggle" aria-expanded={open} aria-controls={panelId} disabled={rootBusy} onClick={()=>setOpen(!open)}>Доступ к инструментам</button>
  {open&&<ToolPolicy key={`${state.me.id}:${bot.id}:${bot.owner}`} bot={bot} state={state} rootBusy={rootBusy} panelId={panelId}/>}
 </div>;
}
function ToolPolicy({bot,state,rootBusy,panelId}:{bot:Bot;state:ChatState;rootBusy:boolean;panelId:string}){
 const [policy,setPolicy]=useState<Policy>();
 const [draft,setDraft]=useState<string[]>([]);
 const [query,setQuery]=useState('');
 const [pending,setPending]=useState(false);
 const [notice,setNotice]=useState('');
 const [error,setError]=useState('');
 const [blocked,setBlocked]=useState(false);
 const epoch=useRef(0);
 const live=useRef({bot:bot.id,owner:bot.owner,account:state.me.id,rootBusy});
 live.current={bot:bot.id,owner:bot.owner,account:state.me.id,rootBusy};
 const supported=!!bot.transportVersion&&bot.transportVersion>=2&&!bot.channel;
 const valid=(request:number)=>epoch.current===request&&live.current.bot===bot.id&&live.current.owner===bot.owner&&live.current.account===state.me.id&&live.current.owner===live.current.account;
 async function load(keepDraft=false){
  const request=++epoch.current;setPending(true);setError('');
  try{
   const next=policyResponse(await botService.toolUsers({bot:bot.id}));
   if(!valid(request))return;
   if(next.owner!==live.current.owner){setBlocked(true);setPolicy(undefined);setError('Владелец бота изменился. Закройте настройки и обновите список ботов.');return}
   setPolicy(next);if(!keepDraft)setDraft(next.users);
   if(keepDraft)setNotice('Настройки изменились на сервере. Свежая версия загружена; ваш выбор сохранён как черновик. Проверьте его и снова нажмите «Сохранить».');
  }catch(e){if(valid(request))setError((e as Error).message||'Не удалось загрузить доступ.')}
  finally{if(valid(request))setPending(false)}
 }
 useEffect(()=>{
  if(supported)void load();
  const invalidate=()=>{++epoch.current;setBlocked(true);setPolicy(undefined);setDraft([]);setPending(false);setError('Аккаунт изменился. Откройте настройки заново.')};
  window.addEventListener('authchange',invalidate);
  return()=>{++epoch.current;window.removeEventListener('authchange',invalidate)};
 // A new bot/account/owner mounts a fresh panel; state polls must not reload private policy.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[]);
 const humans=state.users.filter(user=>!user.bot&&user.id!==bot.owner);
 const owner=state.users.find(user=>user.id===bot.owner)||state.me;
 const search=query.trim().toLocaleLowerCase();
 const matches=humans.filter(user=>`${user.name} ${user.id}`.toLocaleLowerCase().includes(search));
 const invalidSelection=draft.some(id=>!humans.some(user=>user.id===id));
 const dirty=!!policy&&JSON.stringify(normalized(draft))!==JSON.stringify(policy.users);
 const disabled=pending||rootBusy||blocked||!policy;
 function select(id:string,checked:boolean){
  if(disabled)return;
  if(checked&&draft.length>=50){setError('Можно выбрать не более 50 пользователей.');return}
  setDraft(current=>normalized(checked?[...current,id]:current.filter(value=>value!==id)));setNotice('');setError('');
 }
 async function save(){
  if(disabled||!policy||!dirty||draft.length>50||invalidSelection||live.current.rootBusy)return;
  const request=++epoch.current;setPending(true);setError('');setNotice('');
  try{
   const next=policyResponse(await botService.setToolUsers({bot:bot.id,users:normalized(draft),revision:policy.revision}));
   if(!valid(request))return;
   if(next.owner!==live.current.owner){setBlocked(true);setPolicy(undefined);setError('Владелец бота изменился. Обновите список ботов.');return}
   setPolicy(next);setDraft(next.users);setNotice('Доступ сохранён. Сам по себе этот список не включает инструменты.');
  }catch(e){
   if(!valid(request))return;
   const message=(e as Error).message;
   if(/conflict|revision|конфликт|верси[яию]|устарел/i.test(message)){setNotice('Конфликт изменений. Ваш черновик сохранён; загружаем свежую политику.');await load(true)}
   else setError(message||'Не удалось сохранить доступ.');
  }finally{if(valid(request))setPending(false)}
 }
 return <section id={panelId} className="bot-tool-policy" aria-labelledby={`${panelId}-title`} aria-busy={pending}>
  <h4 id={`${panelId}-title`}>Доверенные пользователи</h4>
  <p>Расширенные инструменты Hermes доступны владельцу и только выбранным пользователям по неизменяемому ID. Роли и управление группой не дают этого доступа.</p>
  <label className="bot-tool-person bot-tool-owner"><input type="checkbox" checked disabled/><span><strong>{owner.name}</strong><small>{bot.owner}</small><small>Владелец бота · доступ всегда включён</small></span></label>
  {!supported?<p role="note">{upgrade}</p>:<>
   <label className="bot-tool-search">Поиск пользователей<input type="search" value={query} disabled={blocked} placeholder="Имя или ID" onChange={event=>setQuery(event.target.value)}/></label>
   <p className="bot-tool-count">Выбрано {draft.length} из 50 · владелец не учитывается</p>
   <div className="bot-tool-users" aria-label="Пользователи Sombra">
    {matches.map(user=><label className="bot-tool-person" key={user.id}><input type="checkbox" checked={draft.includes(user.id)} disabled={disabled||(!draft.includes(user.id)&&draft.length>=50)} onChange={event=>select(user.id,event.target.checked)}/><span><strong>{user.name}</strong><small>{user.id}</small></span></label>)}
    {!matches.length&&<p>{pending?'Загрузка настроек…':'Пользователи не найдены.'}</p>}
   </div>
   {invalidSelection&&<div className="bot-tool-missing"><p>Некоторые выбранные ID больше не доступны в списке активных людей. Удалите их перед сохранением.</p>{draft.filter(id=>!humans.some(user=>user.id===id)).map(id=><button type="button" key={id} disabled={disabled} onClick={()=>select(id,false)}>Удалить {id}</button>)}</div>}
   <div className="bot-tool-notices" aria-live="polite">{pending&&<p role="status">{policy?'Сохранение / обновление…':'Загрузка настроек…'}</p>}{notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}</div>
   <div className="bot-tool-footer"><button type="button" disabled={disabled||!dirty||invalidSelection||draft.length>50} onClick={()=>void save()}>Сохранить</button>{!policy&&!pending&&!blocked&&<button type="button" disabled={rootBusy} onClick={()=>void load()}>Повторить загрузку</button>}</div>
  </>}
  <p className="bot-tool-runtime-note">Настройки не включают инструменты автоматически. Нужен отдельно развёрнутый плагин в изолированной среде Hermes — без общих файлов и памяти Telegram и без произвольного выполнения команд на сервере участниками. Выбранный пользователь сможет обращаться к инструментам только там, где ему уже разрешено взаимодействовать с ботом; членство в чатах не добавляется. Права окончательно проверяет сервер.</p>
 </section>;
}
