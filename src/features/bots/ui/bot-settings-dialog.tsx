import {useEffect,useRef,useState} from 'react';
import {Dialog} from 'radix-ui';
import {X} from 'lucide-react';
import {type Bot,type BotModelSettings,type BotReasoning,type User,type ChatState} from '@/shared/api/backend';
import {botService} from '../model/services/bot-service';
import {SettingsPanel} from '@/shared/ui/elements-settings';
import {ImageCropDialog} from '@/shared/ui/image-crop-dialog';
import {UserAvatar} from '@/shared/ui/user-avatar';
import {BotToolAccess} from './bot-tool-access';
import './bot-settings-dialog.css';

type Conversation={mode:'addressed'|'name_dialog';aliases:string[];followupSeconds:number;followupMessages:number;reactions:boolean};
type Settings={bot:Bot;profile:{name:string;bio:string;avatar?:string};revision:number;conversation:Conversation};
type Props={bot:Bot;state:ChatState;refresh:()=>Promise<unknown>;onClose:()=>void};
export function BotSettingsDialog(props:Props){
 const {bot,state,onClose}=props;
 const owner=!state.me.bot&&bot.owner===state.me.id;
 useEffect(()=>{if(!owner)onClose()},[owner,onClose]);
 return owner?<SettingsContent key={`${state.me.id}:${bot.id}:${bot.owner}`} {...props}/>:null;
}
function SettingsContent({bot,state,refresh,onClose}:Props){
 const [tab,setTab]=useState('general'),[loaded,setLoaded]=useState<Settings>(),[name,setName]=useState(''),[bio,setBio]=useState(''),[avatar,setAvatar]=useState<string|undefined>(),[conversation,setConversation]=useState<Conversation>(),[aliases,setAliases]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[file,setFile]=useState<File>();
 const epoch=useRef(0),alive=useRef(true),saving=useRef(false),picker=useRef<HTMLInputElement>(null),avatarButton=useRef<HTMLButtonElement>(null);
 const live=useRef({id:bot.id,owner:bot.owner,actor:state.me.id});live.current={id:bot.id,owner:bot.owner,actor:state.me.id};
 const supported=(bot.managementVersion||0)>=1&&!bot.channel;
 const valid=(request:number)=>alive.current&&epoch.current===request&&live.current.id===bot.id&&live.current.owner===bot.owner&&live.current.actor===state.me.id&&live.current.owner===live.current.actor;
 async function load(keep=false){
  const request=++epoch.current;setBusy(true);setError('');
  try{const value=await botService.settings<Settings>({bot:bot.id});if(!valid(request))return;
   if(value.bot.id!==bot.id||value.bot.owner!==state.me.id||!Number.isSafeInteger(value.revision)||!value.profile||!value.conversation)throw new Error('invalid');
   setLoaded(value);if(!keep){setName(value.profile.name);setBio(value.profile.bio);setAvatar(undefined);setConversation(value.conversation);setAliases(value.conversation.aliases.join(', '));}
   else setNotice('Настройки изменились. Свежая версия загружена, ваш черновик сохранён. Проверьте его и сохраните снова.');
  }catch{if(valid(request))setError('Не удалось загрузить настройки бота. Повторите загрузку.');}finally{if(valid(request))setBusy(false)}
 }
 useEffect(()=>{alive.current=true;if(supported)void load();const invalidate=()=>{alive.current=false;++epoch.current;onClose()};window.addEventListener('authchange',invalidate);return()=>{alive.current=false;++epoch.current;window.removeEventListener('authchange',invalidate)}},[]); // identity is keyed by the parent
 const parsedAliases=aliases.split(/[,\n]/).map(value=>value.trim()).filter(Boolean);
 const invalidAliases=parsedAliases.length>8||parsedAliases.some(value=>value.length<2||value.length>32||/^(all|everyone|here|все)$/i.test(value));
 const draftConversation=conversation?{...conversation,aliases:parsedAliases}:undefined;
 const dirty=!!loaded&&(name!==loaded.profile.name||bio!==loaded.profile.bio||avatar!==undefined||JSON.stringify(draftConversation)!==JSON.stringify(loaded.conversation));
 const disabled=busy||!loaded||!supported;
 const invalid=!name.trim()||name.length>32||bio.length>512||invalidAliases||!conversation||!Number.isInteger(conversation.followupSeconds)||conversation.followupSeconds<0||conversation.followupSeconds>600||!Number.isInteger(conversation.followupMessages)||conversation.followupMessages<0||conversation.followupMessages>20;
 async function save(){
  if(disabled||invalid||!dirty||saving.current||!loaded)return;saving.current=true;const request=++epoch.current;setBusy(true);setError('');setNotice('');
  try{await botService.updateSettings<Settings>({bot:bot.id,revision:loaded.revision,profile:{name:name.trim(),bio,...(avatar!==undefined?{avatar}:{})},conversation:draftConversation});if(!valid(request))return;await refresh();if(valid(request))onClose();}
  catch(reason){if(!valid(request))return;if(String(reason).includes('BOT_SETTINGS_CONFLICT'))await load(true);else setError('Не удалось сохранить настройки бота. Проверьте данные и повторите попытку.');}
  finally{saving.current=false;if(valid(request))setBusy(false)}
 }
 const currentUserEntry:User|undefined=state.users.find(user=>user.id===bot.id);
 const preview={id:bot.id,name:name||currentUserEntry?.name||bot.name,avatar:avatar===undefined?(loaded?.profile.avatar??currentUserEntry?.avatar):avatar};
 function closeCrop(){setFile(undefined);requestAnimationFrame(()=>avatarButton.current?.focus())}
 return <Dialog.Root open onOpenChange={open=>{if(!open&&!busy&&!file)onClose()}}><Dialog.Portal><Dialog.Overlay className="bot-management-overlay"/><Dialog.Content className="bot-management-dialog" data-bot-settings-dialog onEscapeKeyDown={event=>{if(file||busy)event.preventDefault()}} onInteractOutside={event=>{if(file||busy)event.preventDefault()}}>
  <header><div><Dialog.Title>Управление ботом</Dialog.Title><Dialog.Description>{bot.username?'@'+bot.username:bot.name} · настройки владельца</Dialog.Description></div><button type="button" aria-label="Закрыть настройки бота" disabled={busy} onClick={onClose}><X size={20}/></button></header>
  <nav aria-label="Разделы настроек бота">{[['general','Общее'],['model','Модель'],['conversation','Общение'],['access','Доступ']].map(([id,label])=><button type="button" key={id} aria-pressed={tab===id} onClick={()=>setTab(id)}>{label}</button>)}</nav>
  <div className="bot-management-body">
   {!supported&&<p role="note">Для управления этим ботом обновите сервер и подключение бота. Настройки доступны только для просмотра.</p>}
   {busy&&!loaded&&<p role="status">Загрузка настроек…</p>}
   {tab==='general'&&<><div className="bot-management-avatar"><UserAvatar user={preview} size="md" presence={false}/><button type="button" ref={avatarButton} disabled={disabled} onClick={()=>picker.current?.click()}>Изменить аватар</button><button type="button" disabled={disabled} onClick={()=>setAvatar('')}>Удалить аватар</button><input hidden ref={picker} type="file" accept="image/png,image/jpeg,image/webp" aria-label="Аватар бота" onChange={event=>{const next=event.target.files?.[0];event.target.value='';if(next){if(!['image/png','image/jpeg','image/webp'].includes(next.type)){setError('Выберите статичное изображение PNG, JPEG или WebP.');return}setFile(next)}}}/></div><p>Статичное изображение · квадратный PNG 256 × 256. Изменения отправятся только после сохранения.</p><label>Имя бота<input value={loaded?name:bot.name} maxLength={32} disabled={disabled} onChange={event=>setName(event.target.value)}/></label><label>О боте<textarea value={bio} maxLength={512} disabled={disabled} onChange={event=>setBio(event.target.value)}/></label><p>Уникальное имя: {bot.username?'@'+bot.username:'не задано'} · не изменяется здесь.</p><p>Личность и инструменты Сомбры можно настраивать владельцу в личной переписке</p></>}
   <div className="bot-model-settings" hidden={tab!=='model'}><ModelSettings bot={bot} state={state} refresh={refresh} rootBusy={busy}/></div>
   {tab==='conversation'&&<><fieldset disabled={disabled}><legend>Как обращаться к боту в группе</legend>{[['addressed','Только команды и @упоминания'],['name_dialog','Обращение по имени и диалог']].map(([mode,label])=><label className="bot-management-choice" key={mode}><input type="radio" name="bot-conversation-mode" checked={conversation?.mode===mode} onChange={()=>setConversation(value=>value?{...value,mode:mode as Conversation['mode']}:value)}/>{label}</label>)}<label>Имена для обращения<textarea value={aliases} onChange={event=>setAliases(event.target.value)}/></label><p>Через запятую или с новой строки: до 8 имён, каждое от 2 до 32 символов. Общие обращения «all», «everyone», «here», «все» не допускаются.</p><label>Окно продолжения, секунд<input type="number" min={0} max={600} value={conversation?.followupSeconds??180} onChange={event=>setConversation(value=>value?{...value,followupSeconds:event.target.value===''?NaN:Number(event.target.value)}:value)}/></label><label>Сообщений в продолжении<input type="number" min={0} max={20} value={conversation?.followupMessages??8} onChange={event=>setConversation(value=>value?{...value,followupMessages:event.target.value===''?NaN:Number(event.target.value)}:value)}/></label><p>Обычно 180 секунд и 8 сообщений. Продолжать диалог может только тот же участник; сообщения остальных не захватываются. 0 отключает продолжение.</p><label className="bot-management-choice"><input type="checkbox" checked={conversation?.reactions??false} onChange={event=>setConversation(value=>value?{...value,reactions:event.target.checked}:value)}/>Реакции бота</label></fieldset>{invalidAliases&&<p role="alert">Проверьте имена для обращения.</p>}</>}
   {tab==='access'&&<BotToolAccess bot={bot} state={state} rootBusy={busy}/>}
   {notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}{supported&&!loaded&&!busy&&<button type="button" onClick={()=>void load()}>Повторить загрузку</button>}
  </div><footer><span>{dirty?'Есть несохранённые изменения':''}</span><button type="button" disabled={busy} onClick={onClose}>Отмена</button><button type="button" disabled={disabled||invalid||!dirty} onClick={()=>void save()}>{busy?'Сохранение…':'Сохранить'}</button></footer>
  {file&&<ImageCropDialog file={file} kind="avatar" onClose={closeCrop} onConfirm={result=>{setAvatar(result.dataUrl);closeCrop()}}/>}
 </Dialog.Content></Dialog.Portal></Dialog.Root>;
}

const reasoningOptions=[{value:'',label:'По умолчанию'},{value:'low',label:'Низкий'},{value:'medium',label:'Средний'},{value:'high',label:'Высокий'}] as const;
const modelIdentifier=/^[A-Za-z0-9\-_.:/@+]*$/;
const reasoningLabels:Record<Exclude<BotReasoning,''>,'низкий'|'средний'|'высокий'>= {low:'низкий',medium:'средний',high:'высокий'};
function modelSettingsResponse(value:unknown):BotModelSettings{
 const settings=value as BotModelSettings|null;
 if(!settings||typeof settings!=='object'||typeof settings.model!=='string'||settings.model.length>120||!modelIdentifier.test(settings.model)||typeof settings.reasoning!=='string'||!['','low','medium','high'].includes(settings.reasoning)||!Number.isSafeInteger(settings.revision)||settings.revision<0||typeof settings.modelDefault!=='boolean'||typeof settings.reasoningDefault!=='boolean')throw new Error('Некорректный ответ настроек модели.');
 return settings;
}
/** Каталог моделей публикует провайдер/плагин; backend его не хранит, поэтому список необязателен. */
function modelCatalog(bot:Bot):string[]{
 const models=bot.modelSettings?.models;
 if(!Array.isArray(models))return [];
 return [...new Set(models.filter(value=>typeof value==='string'&&value.length<=120&&!!value&&modelIdentifier.test(value)))].slice(0,12);
}
function ModelSettings({bot,state,refresh,rootBusy}:{bot:Bot;state:ChatState;refresh:()=>Promise<unknown>;rootBusy:boolean}){
 const [loaded,setLoaded]=useState<BotModelSettings>(),[model,setModel]=useState(''),[reasoning,setReasoning]=useState<BotReasoning>(''),[pending,setPending]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const epoch=useRef(0),alive=useRef(true);
 const live=useRef({id:bot.id,owner:bot.owner,actor:state.me.id});live.current={id:bot.id,owner:bot.owner,actor:state.me.id};
 const valid=(request:number)=>alive.current&&epoch.current===request&&live.current.id===bot.id&&live.current.owner===bot.owner&&live.current.actor===state.me.id&&live.current.owner===live.current.actor;
 const catalog=modelCatalog(bot);
 const trimmed=model.trim();
 const invalidModel=trimmed.length>120||!modelIdentifier.test(trimmed);
 const dirty=!!loaded&&(trimmed!==loaded.model||reasoning!==loaded.reasoning);
 const disabled=pending||rootBusy||!loaded;
 function edit(next:{model?:string;reasoning?:BotReasoning}){if(next.model!==undefined)setModel(next.model);if(next.reasoning!==undefined)setReasoning(next.reasoning);setNotice('');setError('')}
 async function load(keepDraft=false){
  const request=++epoch.current;setPending(true);setError('');
  try{const next=modelSettingsResponse(await botService.modelSettings({bot:bot.id}));if(!valid(request))return;
   setLoaded(next);
   if(!keepDraft){setModel(next.model);setReasoning(next.reasoning);}
   else setNotice('Настройки изменились на сервере. Свежая версия загружена, ваш черновик сохранён. Проверьте его и сохраните снова.');
  }catch(reason){
   if(!valid(request))return;
   const message=String(reason);
   setError(message.includes('BOT_SETTINGS_FORBIDDEN')?'Настройки модели доступны только владельцу действующего бота. Если владелец — вы, обновите сервер и подключение бота.':/unknown|неизвестн|не поддерж/i.test(message)?'Сервер пока не поддерживает настройки модели. Обновите сервер и подключение бота.':'Не удалось загрузить настройки модели. Повторите загрузку.');
  }finally{if(valid(request))setPending(false)}
 }
 useEffect(()=>{alive.current=true;void load();const invalidate=()=>{alive.current=false;++epoch.current};window.addEventListener('authchange',invalidate);return()=>{alive.current=false;++epoch.current;window.removeEventListener('authchange',invalidate)}},[]); // identity is keyed by the parent
 async function save(){
  if(disabled||!loaded||!dirty||invalidModel)return;
  const request=++epoch.current;setPending(true);setError('');setNotice('');
  try{
   const next=modelSettingsResponse(await botService.updateModelSettings({bot:bot.id,model:trimmed,reasoning,revision:loaded.revision}));
   if(!valid(request))return;
   setLoaded(next);setModel(next.model);setReasoning(next.reasoning);setNotice('Модель и уровень размышления сохранены. Значения применяет Hermes.');
   void refresh().catch(()=>{});
  }catch(reason){
   if(!valid(request))return;
   const message=String(reason);
   if(message.includes('BOT_SETTINGS_CONFLICT')){setNotice('Настройки изменились на сервере. Загружаем свежую версию — проверьте значения и сохраните снова.');await load(true);}
   else if(message.includes('BOT_SETTINGS_FORBIDDEN'))setError('Менять модель и уровень размышления может только владелец действующего бота (не legacy и не отключённого). Если владелец — вы, обновите сервер и подключение бота.');
   else if(message.includes('BOT_SETTINGS_INVALID'))setError('Сервер отклонил значения. Проверьте идентификатор модели: до 120 символов из A–Z, a–z, 0–9 и - _ . : / @ +; уровень размышления — только «по умолчанию», низкий, средний или высокий.');
   else setError('Не удалось сохранить настройки модели: сервер не подтвердил изменения. Попробуйте снова.');
  }finally{if(valid(request))setPending(false)}
 }
 const modelOptions=[...new Set(['',...catalog,...(loaded?.model?[loaded.model]:[])])];
 const currentModel=loaded?(loaded.modelDefault||!loaded.model?'модель по умолчанию':loaded.model):'';
 const currentReasoning=loaded?(loaded.reasoningDefault||!loaded.reasoning?'размышление по умолчанию':(reasoningLabels[loaded.reasoning as Exclude<BotReasoning,''>]??loaded.reasoning)):'';
 return <section aria-labelledby="bot-model-settings-title" aria-busy={pending}>
  <h3 id="bot-model-settings-title">Модель и размышление</h3>
  <p className="bot-model-note">Значения применяет Hermes: пустое значение означает его текущие модель и уровень по умолчанию, которые определяет провайдер. Каталог допустимых моделей публикует провайдер, сервер хранит только выбранный безопасный идентификатор. Изменения вступят в силу после ответа сервера.</p>
  {pending&&!loaded&&<p role="status">Загрузка настроек модели…</p>}
  {!loaded&&!pending&&<button type="button" className="bot-model-retry" disabled={rootBusy} onClick={()=>void load()}>Повторить загрузку</button>}
  {loaded&&<><SettingsPanel className="elements-settings" model={trimmed} models={modelOptions} modelLabel={value=>value||'По умолчанию'}
   onModelChange={value=>edit({model:value})}
   reasoning={{value:reasoning,options:reasoningOptions,onChange:value=>edit({reasoning:value as BotReasoning})}}
   modelInput={catalog.length?undefined:{value:model,onChange:value=>edit({model:value}),invalid:invalidModel,hint:invalidModel?'Недопустимый идентификатор: только A–Z, a–z, 0–9 и - _ . : / @ +, до 120 символов.':'Пустое значение — модель по умолчанию Hermes. Допустимы A–Z, a–z, 0–9 и - _ . : / @ +, до 120 символов.'}}
   disabled={disabled}/>
   <p className="bot-model-current">На сервере: {currentModel} · {currentReasoning}</p></>}
  {notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}
  <div className="bot-model-actions"><button type="button" aria-label="Сохранить модель и уровень размышления" disabled={disabled||!dirty||invalidModel} onClick={()=>void save()}>{pending&&loaded?'Сохранение…':'Сохранить'}</button><span>{dirty?'Есть несохранённые изменения':''}</span></div>
 </section>;
}
