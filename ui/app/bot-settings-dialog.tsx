import {useEffect,useRef,useState} from 'react';
import {Dialog} from 'radix-ui';
import {X} from 'lucide-react';
import {api,type Bot,type User,type ChatState} from '@/shared/api/backend';
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
  try{const value=await api<Settings>('get_bot_settings',{bot:bot.id});if(!valid(request))return;
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
  try{await api<Settings>('update_bot_settings',{bot:bot.id,revision:loaded.revision,profile:{name:name.trim(),bio,...(avatar!==undefined?{avatar}:{})},conversation:draftConversation});if(!valid(request))return;await refresh();if(valid(request))onClose();}
  catch(reason){if(!valid(request))return;if(String(reason).includes('BOT_SETTINGS_CONFLICT'))await load(true);else setError('Не удалось сохранить настройки бота. Проверьте данные и повторите попытку.');}
  finally{saving.current=false;if(valid(request))setBusy(false)}
 }
 const currentUserEntry:User|undefined=state.users.find(user=>user.id===bot.id);
 const preview={id:bot.id,name:name||currentUserEntry?.name||bot.name,avatar:avatar===undefined?(loaded?.profile.avatar??currentUserEntry?.avatar):avatar};
 function closeCrop(){setFile(undefined);requestAnimationFrame(()=>avatarButton.current?.focus())}
 return <Dialog.Root open onOpenChange={open=>{if(!open&&!busy&&!file)onClose()}}><Dialog.Portal><Dialog.Overlay className="bot-management-overlay"/><Dialog.Content className="bot-management-dialog" data-bot-settings-dialog onEscapeKeyDown={event=>{if(file||busy)event.preventDefault()}} onInteractOutside={event=>{if(file||busy)event.preventDefault()}}>
  <header><div><Dialog.Title>Управление ботом</Dialog.Title><Dialog.Description>{bot.username?'@'+bot.username:bot.name} · настройки владельца</Dialog.Description></div><button type="button" aria-label="Закрыть настройки бота" disabled={busy} onClick={onClose}><X size={20}/></button></header>
  <nav aria-label="Разделы настроек бота">{[['general','Общее'],['conversation','Общение'],['access','Доступ']].map(([id,label])=><button type="button" key={id} aria-pressed={tab===id} onClick={()=>setTab(id)}>{label}</button>)}</nav>
  <div className="bot-management-body">
   {!supported&&<p role="note">Для управления этим ботом обновите сервер и подключение бота. Настройки доступны только для просмотра.</p>}
   {busy&&!loaded&&<p role="status">Загрузка настроек…</p>}
   {tab==='general'&&<><div className="bot-management-avatar"><UserAvatar user={preview} size="md" presence={false}/><button type="button" ref={avatarButton} disabled={disabled} onClick={()=>picker.current?.click()}>Изменить аватар</button><button type="button" disabled={disabled} onClick={()=>setAvatar('')}>Удалить аватар</button><input hidden ref={picker} type="file" accept="image/png,image/jpeg,image/webp" aria-label="Аватар бота" onChange={event=>{const next=event.target.files?.[0];event.target.value='';if(next){if(!['image/png','image/jpeg','image/webp'].includes(next.type)){setError('Выберите статичное изображение PNG, JPEG или WebP.');return}setFile(next)}}}/></div><p>Статичное изображение · квадратный PNG 256 × 256. Изменения отправятся только после сохранения.</p><label>Имя бота<input value={loaded?name:bot.name} maxLength={32} disabled={disabled} onChange={event=>setName(event.target.value)}/></label><label>О боте<textarea value={bio} maxLength={512} disabled={disabled} onChange={event=>setBio(event.target.value)}/></label><p>Уникальное имя: {bot.username?'@'+bot.username:'не задано'} · не изменяется здесь.</p><p>Личность и инструменты Сомбры можно настраивать владельцу в личной переписке</p></>}
   {tab==='conversation'&&<><fieldset disabled={disabled}><legend>Как обращаться к боту в группе</legend>{[['addressed','Только команды и @упоминания'],['name_dialog','Обращение по имени и диалог']].map(([mode,label])=><label className="bot-management-choice" key={mode}><input type="radio" name="bot-conversation-mode" checked={conversation?.mode===mode} onChange={()=>setConversation(value=>value?{...value,mode:mode as Conversation['mode']}:value)}/>{label}</label>)}<label>Имена для обращения<textarea value={aliases} onChange={event=>setAliases(event.target.value)}/></label><p>Через запятую или с новой строки: до 8 имён, каждое от 2 до 32 символов. Общие обращения «all», «everyone», «here», «все» не допускаются.</p><label>Окно продолжения, секунд<input type="number" min={0} max={600} value={conversation?.followupSeconds??180} onChange={event=>setConversation(value=>value?{...value,followupSeconds:event.target.value===''?NaN:Number(event.target.value)}:value)}/></label><label>Сообщений в продолжении<input type="number" min={0} max={20} value={conversation?.followupMessages??8} onChange={event=>setConversation(value=>value?{...value,followupMessages:event.target.value===''?NaN:Number(event.target.value)}:value)}/></label><p>Обычно 180 секунд и 8 сообщений. Продолжать диалог может только тот же участник; сообщения остальных не захватываются. 0 отключает продолжение.</p><label className="bot-management-choice"><input type="checkbox" checked={conversation?.reactions??false} onChange={event=>setConversation(value=>value?{...value,reactions:event.target.checked}:value)}/>Реакции бота</label></fieldset>{invalidAliases&&<p role="alert">Проверьте имена для обращения.</p>}</>}
   {tab==='access'&&<BotToolAccess bot={bot} state={state} rootBusy={busy}/>}
   {notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}{supported&&!loaded&&!busy&&<button type="button" onClick={()=>void load()}>Повторить загрузку</button>}
  </div><footer><span>{dirty?'Есть несохранённые изменения':''}</span><button type="button" disabled={busy} onClick={onClose}>Отмена</button><button type="button" disabled={disabled||invalid||!dirty} onClick={()=>void save()}>{busy?'Сохранение…':'Сохранить'}</button></footer>
  {file&&<ImageCropDialog file={file} kind="avatar" onClose={closeCrop} onConfirm={result=>{setAvatar(result.dataUrl);closeCrop()}}/>}
 </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
