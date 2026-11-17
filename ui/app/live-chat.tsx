import {useScreenGlitch} from '../shared/ui/use-screen-glitch';
import {MotionIcon} from '../shared/ui/motion-icon';
import {UpdateSettings} from './updates';
import {ColumnResizer} from './column-resizer';
import {Select} from '@/shared/ui/select';
import {MessageItem,ExpressionPicker,Bots,Friends} from './chat-extras';
import {StickerLibrary} from './sticker-library';
import {StickerSuggestions} from './sticker-suggestions';
import {useDirectMessageNotifications} from './direct-message-notifications';
import {UserActionsProvider,type FriendStatus} from './user-actions';
import {UserRow} from './user-row';
import {UserProfile} from './user-profile';
import {MemberList} from './member-list';
import {VoiceQuickSettings} from './voice-quick-settings';
import {NewDialogDialog} from './new-dialog-dialog';
import {useDialogCalls,DialogCallBanner,IncomingDialogCall} from './dialog-calls';
import {AttachmentComposer,readAttachment,pastedAttachment} from './attachment-composer';
import type {AttachmentDraft} from '@/shared/api/backend';

import {useVoice} from './use-voice';
import {VoiceParticipants} from './voice-participants';
import {VoiceStage,VoiceSettings,Media} from './voice';
import {AccountSidebar,accountSections,type AccountSection} from './account-sidebar';
import {Button} from '@/shared/ui/button';
import {EntityContextMenu} from '@/shared/ui/entity-context-menu';
import {AccountSecurity} from './account-security';
import {toast} from 'sonner';
import {prepareAvatar} from '@/shared/lib/prepare-avatar';
﻿import {useEffect,useRef,useState,type FormEvent} from 'react';
import {Home,Phone,Video,Bot,ChevronUp,Volume2,Plus,MessageCircle,Users,Settings,LogOut,Send,X,Search,Mic,MicOff,Headphones,HeadphoneOff} from 'lucide-react';
import {api,logout,type ChatState,type Group,type Channel,type Dialog} from '@/shared/api/backend';
import './chat.css';
import {useChatDraft} from './use-chat-draft';
export function LiveChat(){
 const call=useVoice();
 const microphoneOff=call.muted||call.deaf;
 const [accountSection,setAccountSection]=useState<AccountSection>('profile');
 useEffect(()=>{const open=()=>{setAccountSection('updates');setSettings(true)};window.addEventListener('sombra:open-updates',open);return()=>window.removeEventListener('sombra:open-updates',open)},[]);
 const [state,setState]=useState<ChatState|null>(null),[groupId,setGroupId]=useState(''),[channelId,setChannelId]=useState(''),[home,setHome]=useState(true),[error,setError]=useState(''),[search,setSearch]=useState(''),[settings,setSettings]=useState(false),[modal,setModal]=useState(''),[name,setName]=useState(''),[selected,setSelected]=useState<string[]>([]),[busy,setBusy]=useState(false),[members,setMembers]=useState(false),[profileId,setProfileId]=useState('');
 const conversationMotion=useScreenGlitch(`${home}:${groupId}:${channelId}`);
 const settingsMotion=useScreenGlitch(`${settings}:${accountSection}`);
 const [participantVolumes,setParticipantVolumes]=useState<Record<string,number>>({});
 const pendingFriendRequests=useRef(new Set<string>());
 const meId=state?.me.id;
 const volumeKey=(id:string)=>`sombra-participant-volume:${meId}:${id}`;
 function volumeForUser(id:string){
  if(!meId||!id||id===meId)return 100;
  const key=volumeKey(id);
  const current=participantVolumes[key];
  if(current!==undefined)return current;
  try{
   const stored=localStorage.getItem(key);
   if(stored===null)return 100;
   const value=Number(stored);
   if(Number.isFinite(value)&&value>=0&&value<=200)return value;
  }catch{}
  return 100;
 }
 function setUserVolume(id:string,volume:number){
  const key=volumeKey(id);
  setParticipantVolumes(previous=>({...previous,[key]:volume}));
  try{localStorage.setItem(key,String(volume))}catch{}
 }
 function canRequestFriend(id:string){
  return !!state&&id!==state.me.id&&!state.friends.some(friend=>
   (friend.from===id&&friend.to===state.me.id)||(friend.to===id&&friend.from===state.me.id));
 }
 async function requestFriend(id:string){
  if(!canRequestFriend(id)||pendingFriendRequests.current.has(id))return;
  pendingFriendRequests.current.add(id);
  try{
   await api('friend_request',{user:id});
   await refresh();
   toast.success('Заявка в друзья отправлена');
  }catch(e){toast.error((e as Error).message)}
  finally{pendingFriendRequests.current.delete(id)}
 }
 function friendStatus(id:string):FriendStatus{
  if(!state)return 'none';
  if(id===state.me.id)return 'self';
  const friend=state.friends.find(item=>
   (item.from===id&&item.to===state.me.id)||(item.to===id&&item.from===state.me.id));
  if(!friend)return 'none';
  if(friend.accepted)return 'friends';
  return friend.from===state.me.id?'outgoing':'incoming';
 }
 async function acceptFriend(id:string){
  const friend=state?.friends.find(item=>item.from===id&&item.to===state.me.id);
  if(!friend)return;
  try{await api('friend_accept',{id:friend.id});await refresh();toast.success('Заявка принята')}
  catch(e){toast.error((e as Error).message)}
 }
 async function removeFriend(id:string){
  const friend=state?.friends.find(item=>
   (item.from===id&&item.to===state.me.id)||(item.to===id&&item.from===state.me.id));
  if(!friend)return;
  try{await api('friend_remove',{id:friend.id});await refresh()}
  catch(e){toast.error((e as Error).message)}
 }
 async function messageUser(id:string){
  if(!state||id===state.me.id)return;
  const existing=state.dialogs.find(dialog=>
   dialog.members.length===2&&dialog.members.includes(id)&&dialog.members.includes(state.me.id));
  if(existing){setHome(true);setChannelId(existing.id);return}
  try{
   const dialog=await api<Dialog>('create_dialog',{members:[id],name:''});
   await refresh();
   setHome(true);
   setChannelId(dialog.id);
  }catch(e){toast.error((e as Error).message)}
 }
 function openOwnProfile(){
  setAccountSection('profile');
  setSettings(true);
 }
 useDirectMessageNotifications(state);
 async function refresh(){const next=await api<ChatState>('state',{sticker_assets:true});setState(next);return next}
 useEffect(()=>{let active=true;async function load(){try{const next=await api<ChatState>('state',{sticker_assets:true});if(active)setState(next)}catch(e){if(active)setError((e as Error).message)}}void load();const timer=setInterval(load,2000);return()=>{active=false;clearInterval(timer)}},[]);
 const dialogCalls=useDialogCalls({state,voice:call,refresh,onOpenDialog:id=>{setHome(true);setChannelId(id);setModal('')}});
 const currentDialogCall=home?dialogCalls.calls.find(item=>item.dialog===channelId):undefined;
 const voiceRoom=home&&currentDialogCall?currentDialogCall.id:undefined;
 const group=state?.groups.find(g=>g.id===groupId)||state?.groups[0];
 const canShowMembers=!home&&!!group;
 const channel=home?state?.dialogs.find(d=>d.id===channelId):(group?.channels.find(c=>c.id===channelId)||group?.channels.find(c=>c.name==='games')||group?.channels[0]);
 const {draft,setDraft,clearSent}=useChatDraft(channel?.id||'');
 const [attachments,setAttachments]=useState<Record<string,AttachmentDraft|undefined>>({});
 const [readingAttachments,setReadingAttachments]=useState<Record<string,boolean>>({});
 const attachmentReads=useRef<Record<string,number>>({});
 const attachment=channel?attachments[channel.id]:undefined;
 const readingAttachment=channel?!!readingAttachments[channel.id]:false;
 async function selectAttachment(file:File){
  if(!channel||busy)return;
  const destination=channel.id;
  const epoch=(attachmentReads.current[destination]||0)+1;
  attachmentReads.current[destination]=epoch;
  setReadingAttachments(previous=>({...previous,[destination]:true}));
  try{
   const result=await readAttachment(file);
   if(attachmentReads.current[destination]===epoch)setAttachments(previous=>({...previous,[destination]:result}));
  }catch(error){toast.error((error as Error).message)}
  finally{if(attachmentReads.current[destination]===epoch)setReadingAttachments(previous=>({...previous,[destination]:false}))}
 }
 function removeAttachment(){
  if(!channel)return;
  attachmentReads.current[channel.id]=(attachmentReads.current[channel.id]||0)+1;
  setAttachments(previous=>({...previous,[channel.id]:undefined}));
  setReadingAttachments(previous=>({...previous,[channel.id]:false}));
 }
 const [editingChannel,setEditingChannel]=useState<{group:string;channel:Channel}|null>(null);
 const [editingGroup,setEditingGroup]=useState<Pick<Group,'id'|'name'|'avatar'>|null>(null);
 const [avatarDraft,setAvatarDraft]=useState<string>();
 const groupAvatar=avatarDraft??editingGroup?.avatar??'';
 const groupAvatarChanged=groupAvatar!==(editingGroup?.avatar??'');
 const [channelKind,setChannelKind]=useState('text');
 const end=useRef<HTMLDivElement>(null);
 const voice=(!!channel&&'kind' in channel&&channel.kind==='voice')||!!(voiceRoom&&call.room===voiceRoom);
 const [dialogSearch,setDialogSearch]=useState('');
 const dialogName=(d:Dialog)=>d.members.length===2?(state?.users.find(u=>u.id!==state.me.id&&d.members.includes(u.id))?.name||d.name):d.name;
 const latest=new Map<string,ChatState['messages'][number]>();
 for(const message of state?.messages||[]){if(!latest.has(message.channel)||latest.get(message.channel)!.time<=message.time)latest.set(message.channel,message)}
 const dialogs=(state?.dialogs||[]).filter(d=>dialogName(d).toLocaleLowerCase().includes(dialogSearch.trim().toLocaleLowerCase())).sort((a,b)=>(latest.get(b.id)?.time||0)-(latest.get(a.id)?.time||0));
 const showFriends=home&&channelId==='friends';
 const title=showFriends?'Друзья':channel?(home?dialogName(channel as Dialog):channel.name):(home?'Выберите переписку':group?'Выберите канал':'Выберите группу');
 const dmPeer=home&&channel&&'members' in channel&&channel.members.length===2?state?.users.find(user=>user.id!==state.me.id&&(channel as Dialog).members.includes(user.id)):undefined;
 const userName=(id:string)=>state?.users.find(u=>u.id===id)?.name||'Участник';
 function open(kind:string){setChannelKind('text');setModal(kind);setName('');setSelected([]);setError('')}
 function editGroup(target:Group){
  if(target.owner!==state?.me.id)return;
  setEditingGroup({id:target.id,name:target.name,avatar:target.avatar});
  setAvatarDraft(undefined);
  setName(target.name);
  setError('');
  setModal('edit-group');
 }
 async function selectGroupAvatar(file:File){
  setBusy(true);
  setError('');
  try{setAvatarDraft(await prepareAvatar(file))}
  catch(e){setError((e as Error).message)}
  finally{setBusy(false)}
 }
 function manageStickers(scope:'personal'|'group'){
  if(scope==='group'){
   if(!group||group.owner!==state?.me.id)return;
   setEditingGroup({id:group.id,name:group.name,avatar:group.avatar});
   setModal('group-stickers');
   return;
  }
  setAccountSection('stickers');
  setSettings(true);
 }
 function editChannel(c:Channel){if(!group||group.owner!==state?.me.id)return;setEditingChannel({group:group.id,channel:c});setName(c.name);setError('');setModal('edit-channel')}
 function channelSettings(c:Channel){return group?.owner===state?.me.id?<button type="button" className="channel-settings" title="Настроить канал" aria-label={`Настроить канал ${c.name}`} onClick={()=>editChannel(c)}><MotionIcon icon={Settings} kind="settings" size={16}/></button>:null}
 async function send(e:FormEvent){
  e.preventDefault();
  if(!channel||(!draft.trim()&&!attachment)||busy||readingAttachment)return;
  const destination=channel.id,sent=draft,sentAttachment=attachment;
  setBusy(true);setError('');
  try{
   await api('message',{channel:destination,text:sent,...(sentAttachment?{attachment:sentAttachment}:{})});
   clearSent(destination,sent);
   if(sentAttachment)setAttachments(previous=>previous[destination]===sentAttachment?{...previous,[destination]:undefined}:previous);
   await refresh();
  }catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 async function sendStickerSuggestion(sticker:string,replaceDraft:boolean){
  if(!channel||busy)return false;
  const destination=channel.id,sent=draft;
  setBusy(true);setError('');
  try{
   await api('message',{channel:destination,sticker});
   if(replaceDraft)clearSent(destination,sent);
   void refresh().catch(e=>setError(e.message));
   return true;
  }catch(e){setError((e as Error).message);return false}
  finally{setBusy(false)}
 }
 async function create(e:FormEvent){e.preventDefault();if(busy||modal==='group-stickers')return;setBusy(true);setError('');try{
 if(modal==='invite'){
  if(!group||group.owner!==state?.me.id)return;
  await api('invite_group_member',{group:group.id,email:name.trim()});
  setModal('');
  toast.success('Участник добавлен в группу');
  return;
 }
 if(modal==='edit-group'&&editingGroup){
  await api('update_group',{
   group:editingGroup.id,
   ...(name.trim()!==editingGroup.name&&{name}),
   ...(groupAvatarChanged&&{avatar:groupAvatar}),
  });
 }
 else if(modal==='edit-channel'&&editingChannel){await api('update_channel',{group:editingChannel.group,channel:editingChannel.channel.id,name})}
 else if(modal==='delete-channel'&&editingChannel){
  const target=editingChannel.channel.id;
  await api('delete_channel',{group:editingChannel.group,channel:target});
  if(call.room===target)call.leave();
  setChannelId(selected=>selected===target?'':selected);
  setModal('');
  toast.success('Канал удалён');
 }
 else if(modal==='dialog'){const d=await api<Dialog>('create_dialog',{name,members:selected});setHome(true);setChannelId(d.id)}
 else if(modal==='group'){const created=await api<Group>('create_group',{name});setGroupId(created.id);setChannelId('');setHome(false)}
 else if(modal==='join'){const joined=await api<Group>('join_group',{invite:name.trim()});setGroupId(joined.id);setChannelId('');setHome(false)}
 else if(modal==='channel'){const created=await api<Channel>('create_channel',{group:group?.id,name,kind:channelKind});setChannelId(created.id)}
 await refresh();setModal('');
 }catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 useEffect(()=>{setSearch('');setError('')},[channel?.id]);
 useEffect(()=>{end.current?.scrollIntoView({block:'nearest'})},[channel?.id,state?.messages.length]);
 useEffect(()=>{if((!modal||modal==='dialog')&&!settings)return;const previous=document.activeElement as HTMLElement;const dialog=document.querySelector<HTMLElement>('[role=dialog]');dialog?.querySelector<HTMLElement>('input,button')?.focus();const handle=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!busy){setModal('');setSettings(false);setError('')}if(e.key==='Tab'&&dialog){const items=Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select,a[href]'));const visible=items.filter(item=>item.getClientRects().length>0);const first=visible[0],last=visible.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}}};window.addEventListener('keydown',handle);return()=>{window.removeEventListener('keydown',handle);previous?.focus()}},[modal,settings,busy]);
 const visibleMessages=state?.messages.filter(m=>m.channel===channel?.id&&(m.text+' '+userName(m.user)).toLowerCase().includes(search.toLowerCase()))||[];
 const profile=profileId&&state?(state.me.id===profileId?state.me:state.users.find(user=>user.id===profileId)):undefined;
 return <UserActionsProvider value={{me:state?.me,openProfile:setProfileId,messageUser:id=>void messageUser(id),editOwnProfile:openOwnProfile,friendStatus,addFriend:id=>void requestFriend(id),acceptFriend:id=>void acceptFriend(id),removeFriend:id=>void removeFriend(id)}}>
 <main className="chat-shell">
 <div className="voice-playback">{Object.entries(call.streams).map(([id,stream])=>{
  const peer=call.peers.find(peer=>peer.client===id);
  const volume=call.preferences.volume*(peer?volumeForUser(peer.user)/100:1);
  return stream.getAudioTracks().length?<Media key={id} stream={stream} muted={call.deaf} volume={volume} speaker={call.preferences.speaker} audioOnly/>:null;
 })}</div>
 <nav className="server-rail" aria-label="Группы">
  <button className={'server '+(home?'active':'')} title="Личные сообщения" onClick={()=>{setHome(true);setChannelId('')}}><Home size={22} aria-hidden="true"/></button>
  <div className="rail-line"/>
  {state?.groups.map(g=><EntityContextMenu
   key={g.id}
   actions={g.owner===state.me.id?[{label:'Настройки группы',icon:Settings,onSelect:()=>editGroup(g)}]:undefined}
  >
   <button className={'server '+(!home&&group?.id===g.id?'active':'')} title={g.name} aria-label={g.name} onClick={()=>{setGroupId(g.id);setChannelId('');setHome(false)}}>
    {g.avatar?<img className="server-avatar" src={g.avatar} alt=""/>:g.name.slice(0,2)}
   </button>
  </EntityContextMenu>)}
  <button className="server" title="Создать группу" onClick={()=>open('group')}><Plus/></button>
  <button className="server" title="Вступить по приглашению" onClick={()=>open('join')}><Users/></button>
 </nav>
 <aside className="channel-sidebar"><ColumnResizer label="Ширина списка каналов" side="right" variable="--channel-width" min={190} max={480}/>{home?<header className="dialog-search-header"><label className="dialog-search"><Search size={17}/><input aria-label="Поиск переписок" placeholder="Поиск" value={dialogSearch} onChange={e=>setDialogSearch(e.target.value)}/>{dialogSearch&&<button aria-label="Очистить поиск переписок" onClick={()=>setDialogSearch('')}><X size={15}/></button>}</label><button className="new-dialog" title="Новый диалог" onClick={()=>open('dialog')}><Plus size={19}/></button></header>:<header className="group-header">
 <strong title={group?.name}>{group?.name||'Ваши группы'}</strong>
 <button title="Новый диалог" onClick={()=>open('dialog')}><Plus size={19}/></button>
 {group&&group.owner===state?.me.id&&<button type="button" className="group-settings-button" title="Настройки группы" aria-label="Настройки группы" onClick={()=>editGroup(group)}><MotionIcon icon={Settings} kind="settings" size={17}/></button>}
 </header>}<div className="channel-list">{home?<><Button type="button" variant="ghost" className={'friends-nav '+(showFriends?'selected':'')} aria-pressed={showFriends} onClick={()=>setChannelId('friends')}><Users size={20}/><span>Друзья</span>{!!state?.friends.filter(friend=>!friend.accepted&&friend.to===state.me.id).length&&<small>{state.friends.filter(friend=>!friend.accepted&&friend.to===state.me.id).length}</small>}</Button><div className="category">Личные сообщения<button type="button" title="Создать сообщение" aria-label="Создать сообщение" onClick={()=>open('dialog')}><Plus size={15}/></button></div><div className="dialog-list" aria-label="Переписки">{dialogs.map(d=>{const last=latest.get(d.id);const peer=d.members.length===2?state?.users.find(u=>u.id!==state.me.id&&d.members.includes(u.id)):undefined;const name=dialogName(d);return <UserRow key={d.id} as="button" variant="dialog" className={'dialog-row '+(d.id===channel?.id?'selected':'')} selected={d.id===channel?.id} identity={peer||{id:d.id,name}} subtitle={last?`${last.user===state?.me.id?'Вы: ':''}${last.text||(last.attachment?`Файл: ${last.attachment.name}`:last.sticker?'Стикер':'')}`:'Нет сообщений'} meta={last?<time dateTime={new Date(last.time*1000).toISOString()}>{new Date(last.time*1000).toLocaleDateString()===new Date().toLocaleDateString()?new Date(last.time*1000).toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'}):new Date(last.time*1000).toLocaleDateString('ru',{day:'numeric',month:'short'})}</time>:null} onClick={()=>setChannelId(d.id)} menu={!!peer} presence={!!peer}/>})}</div>{!dialogs.length&&<p className="dialog-empty">{dialogSearch.trim()?'Переписки не найдены':state?'Пока нет переписок. Нажмите +, чтобы начать разговор.':'Загрузка переписок…'}</p>}</>:<>{group&&<button className="channel" onClick={()=>open('invite')}><Users/>Пригласить участников</button>}<div className="category">Текстовые каналы{group?.owner===state?.me.id&&<button title="Добавить канал" onClick={()=>open('channel')}><Plus size={15}/></button>}</div>{group?.channels.filter(c=>c.kind==='text').map(c=><div className={'channel-row '+(c.id===channel?.id?'selected':'')} key={c.id}><button className={'channel '+(c.id===channel?.id?'selected':'')} onClick={()=>setChannelId(c.id)}><MessageCircle/><span>{c.name}</span></button>{channelSettings(c)}</div>)}<div className="category">Голосовые каналы</div>{group?.channels.filter(c=>c.kind==='voice').map(c=><div className="voice-channel" key={c.id}><div className={'channel-row '+(c.id===channel?.id?'selected':'')}><button className={'channel '+(c.id===channel?.id?'selected':'')} key={c.id} onClick={()=>setChannelId(c.id)} onDoubleClick={()=>{setChannelId(c.id);if(call.room!==c.id&&!call.busy)void call.join(c.id)}}><Volume2/><span>{c.name}</span></button>{channelSettings(c)}</div>
 <VoiceParticipants voice={call} room={c.id} title={c.name} me={state?.me} users={state?.users||[]} presence={state?.voicePresence?.[c.id]}
  volumeForUser={volumeForUser} setUserVolume={setUserVolume}
  canRequestFriend={canRequestFriend} requestFriend={id=>void requestFriend(id)}/>
 </div>)}{!group&&<p>Создайте группу или вступите по приглашению.</p>}</>}</div>{call.room&&<div className="voice-status">Голосовая связь · {state?.groups.flatMap(g=>g.channels).find(c=>c.id===call.room)?.name||state?.dialogs.find(dialog=>dialog.id===dialogCalls.calls.find(item=>item.id===call.room)?.dialog)?.name||'Личный звонок'}<button onClick={call.leave}>Отключиться</button></div>}
 <footer className="profile"><button type="button" className="profile-self" title="Открыть свой профиль" onClick={()=>state&&setProfileId(state.me.id)}><span className="avatar">{state?.me.avatar?<img src={state.me.avatar} alt=""/>:state?.me.name[0]}<span data-online={state?.me.online?'true':'false'}/></span><span className="profile-name"><strong>{state?.me.name||'Загрузка…'}</strong><small>{state?.me.online?'В сети':'Не в сети'}</small></span></button>
  <div className="voice-device-control"><Button type="button" variant="ghost" size="icon-sm" title={microphoneOff?'Включить микрофон':'Выключить микрофон'} aria-label="Микрофон" aria-pressed={microphoneOff} onClick={call.toggleMic}>{microphoneOff?<MotionIcon icon={MicOff} kind="device" size={18} className="text-red-400"/>:<MotionIcon icon={Mic} kind="device" size={18}/>}</Button><VoiceQuickSettings voice={call} kind="input" onSettings={()=>{setAccountSection('voice');setSettings(true)}}/></div>
  <div className="voice-device-control"><Button type="button" variant="ghost" size="icon-sm" title={call.deaf?'Включить звук':'Отключить звук'} aria-label="Наушники" aria-pressed={call.deaf} onClick={call.toggleDeaf}>{call.deaf?<MotionIcon icon={HeadphoneOff} kind="device" size={18} className="text-red-400"/>:<MotionIcon icon={Headphones} kind="device" size={18}/>}</Button><VoiceQuickSettings voice={call} kind="output" onSettings={()=>{setAccountSection('voice');setSettings(true)}}/></div>
  <button title="Настройки пользователя" onClick={()=>setSettings(true)}><MotionIcon icon={Settings} kind="settings" size={19}/></button></footer></aside>
 <section className="conversation"><header className="chat-header">{home?<MessageCircle/>:voice?<Volume2/>:<MessageCircle/>}<strong>{dmPeer?<button type="button" className="chat-header-user" title={`Профиль ${dmPeer.name}`} onClick={()=>setProfileId(dmPeer.id)}>{title}</button>:title}</strong><div className="header-actions">{home&&channel&&!showFriends&&<div className="dialog-call-header-actions"><Button type="button" variant="ghost" size="icon-sm" title="Начать аудиозвонок" aria-label="Начать аудиозвонок" disabled={dialogCalls.busy||call.busy} onClick={()=>void dialogCalls.start(channel.id,false)}><Phone/></Button><Button type="button" variant="ghost" size="icon-sm" title="Начать видеозвонок" aria-label="Начать видеозвонок" disabled={dialogCalls.busy||call.busy} onClick={()=>void dialogCalls.start(channel.id,true)}><Video/></Button></div>}{!home&&channel&&<button title="Боты комнаты" onClick={()=>open('bots')}><Bot/></button>}{canShowMembers&&<button title="Участники" aria-pressed={members} onClick={()=>setMembers(open=>!open)}><Users/></button>}<label className="chat-search"><input aria-label="Поиск сообщений" placeholder="Поиск сообщений" value={search} onChange={e=>setSearch(e.target.value)}/><Search size={17}/></label></div></header>{error&&<div className="chat-notice" role="alert">{error}<a href="#login">Войти</a><button onClick={()=>setError('')} title="Закрыть"><X size={16}/></button></div>}
 {dialogCalls.error&&!dialogCalls.incoming&&<div className="chat-notice" role="alert">{dialogCalls.error}<button type="button" aria-label="Закрыть ошибку звонка" onClick={dialogCalls.clearError}><X size={16}/></button></div>}
 {currentDialogCall&&<DialogCallBanner call={currentDialogCall} joined={call.room===currentDialogCall.id} busy={dialogCalls.busy||call.busy} onJoin={()=>void dialogCalls.join(currentDialogCall)} onLeave={call.leave}/>}
 <div className="conversation-body" ref={conversationMotion}><div className={voice?"chat-main voice-layout":"chat-main"}>{voice&&<ColumnResizer label="Ширина чата канала" side="left" variable="--voice-chat-width" min={260} max={600} target=".voice-messages"/>}{showFriends&&state?<Friends state={state} refresh={refresh} onError={setError} onDialog={id=>{setHome(true);setChannelId(id)}}/>:voice?<VoiceStage voice={call} id={voiceRoom||channel!.id} title={title} userName={userName} me={state?.me.name||"Вы"} meUser={state?.me} users={state?.users} onSettings={()=>{setAccountSection("voice");setSettings(true)}}/>:<div className="message-scroll">{!channel&&home&&state?<p className="conversation-empty">Выберите переписку слева или начните новый диалог кнопкой +.</p>:<>{!visibleMessages.length&&!search&&<p className="conversation-empty">{channel?'Пока тихо. Начните разговор — отправьте первое сообщение.':'Выберите или создайте комнату, чтобы начать общение.'}</p>}{state&&visibleMessages.map((m,i)=><div key={m.id}>{(i===0||new Date(m.time*1000).toDateString()!==new Date(visibleMessages[i-1].time*1000).toDateString())&&<div className="chat-day"><span>{new Date(m.time*1000).toLocaleDateString('ru',{day:'numeric',month:'long',year:'numeric'})}</span></div>}<MessageItem previous={visibleMessages[i-1]} message={m} state={state} refresh={refresh} onError={setError} userName={userName}/></div>)}</>}{search&&!visibleMessages.length&&<p className="no-results">Сообщения не найдены</p>}<div ref={end}/></div>}{voice&&<div className="voice-messages"><h3>Чат канала · {title}</h3>{state&&visibleMessages.map((m,i)=><div key={m.id}>{(i===0||new Date(m.time*1000).toDateString()!==new Date(visibleMessages[i-1].time*1000).toDateString())&&<div className="chat-day"><span>{new Date(m.time*1000).toLocaleDateString('ru',{day:'numeric',month:'long',year:'numeric'})}</span></div>}<MessageItem previous={visibleMessages[i-1]} message={m} state={state} refresh={refresh} onError={setError} userName={userName}/></div>)}<div ref={end}/></div>}{channel&&<form className="composer" onSubmit={send}><AttachmentComposer draft={attachment} reading={readingAttachment} disabled={busy} onFile={file=>void selectAttachment(file)} onRemove={removeAttachment}/><textarea rows={1} onPaste={event=>{const file=pastedAttachment(event);if(file)void selectAttachment(file)}} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();e.currentTarget.form?.requestSubmit()}}} aria-label="Сообщение" placeholder={`Написать в ${title}`} value={draft} disabled={!channel} onChange={e=>setDraft(e.target.value)} maxLength={2000}/>{state&&<StickerSuggestions key={channel.id} draft={draft} stickers={state.stickers} user={state.me.id} group={home?undefined:group?.id} busy={busy} onSelect={sendStickerSuggestion}/>}{state&&<ExpressionPicker key={channel.id} state={state} refresh={refresh} onError={setError} disabled={busy} group={home?undefined:group} onManage={manageStickers} onEmoji={e=>setDraft(draft+e)} onSticker={async sticker=>{await api('message',{channel:channel.id,sticker});await refresh()}}/>}<button type="submit" title="Отправить сообщение" disabled={busy||readingAttachment||!channel||(!draft.trim()&&!attachment)}><MotionIcon icon={Send} kind="send" size={20}/></button></form>}</div>{canShowMembers&&members&&<aside className="member-list" aria-label="Участники"><ColumnResizer label="Ширина списка участников" side="left" variable="--member-width" min={180} max={420}/>{state&&group?<MemberList members={group.members} users={state.users} meId={state.me.id}/>:<p className="member-empty">Загрузка участников…</p>}</aside>}</div></section>
 {settings&&<div className="modal-backdrop" onClick={()=>setSettings(false)}><section role="dialog" aria-modal="true" aria-label="Учётная запись" className="account-modal dark" onClick={e=>e.stopPropagation()}><AccountSidebar avatar={state?.me.avatar} name={state?.me.name||''} section={accountSection} onSection={setAccountSection} onLogout={()=>{void logout().catch(e=>setError(e.message))}}/><article><header><span>{accountSections.find(item=>item.id===accountSection)?.label}</span><Button variant="ghost" size="icon-sm" title="Закрыть настройки" aria-label="Закрыть настройки" onClick={()=>setSettings(false)}><X/></Button></header><div id="account-panel" ref={settingsMotion}>{accountSection==='updates'?<UpdateSettings inCall={!!call.room||call.busy}/>:accountSection==='voice'?<VoiceSettings voice={call}/>:accountSection==='stickers'&&state?<StickerLibrary stickers={state.stickers} user={state.me.id} refresh={refresh}/>:<AccountSecurity state={state} refresh={refresh} section={accountSection}/>}</div></article></section></div>}
 {modal==='dialog'&&state&&<NewDialogDialog state={state} refresh={refresh} onClose={()=>setModal('')} onCreated={dialog=>{setHome(true);setChannelId(dialog.id);setModal('')}}/>}
 {dialogCalls.incoming&&state&&<IncomingDialogCall call={dialogCalls.incoming} state={state} busy={dialogCalls.busy||call.busy} error={dialogCalls.error} onAccept={video=>void dialogCalls.join(dialogCalls.incoming!,video)} onDecline={()=>void dialogCalls.decline(dialogCalls.incoming!)}/>}
 {modal&&modal!=='dialog'&&<div className="modal-backdrop"><form className="group-modal" role="dialog" aria-modal="true" aria-label={modal==='delete-channel'?'Удалить канал':modal==='edit-group'?'Настройки группы':'Управление чатами'} onSubmit={create}><h2>{{group:'Создать группу',join:'Вступить в группу',dialog:'Новый диалог',channel:'Создать канал','edit-channel':'Настроить канал','delete-channel':'Удалить канал','edit-group':'Настройки группы','group-stickers':'Стикеры группы',invite:'Пригласить участников',bots:'Подключения'}[modal]}</h2>{modal==='group-stickers'&&state&&editingGroup?<StickerLibrary stickers={state.stickers} user={state.me.id} group={editingGroup.id} refresh={refresh}/>:modal==='bots'&&state&&channel?<Bots state={state} refresh={refresh} onError={setError} channel={channel.id} owner={group?.owner===state.me.id}/>:modal==='invite'?<>
 {group?.owner===state?.me.id&&<>
  <label htmlFor="invite-email">Email аккаунта Sombra</label>
  <input id="invite-email" type="email" autoComplete="off" autoFocus required disabled={busy} maxLength={254} value={name} onChange={e=>{setName(e.target.value);setError('')}}/>
 </>}
 <p>Код приглашения</p>
 <input readOnly aria-label="Код приглашения" value={group?.invite||''}/>
 <button type="button" className="small-button" onClick={()=>{void navigator.clipboard.writeText(group?.invite||'').then(()=>toast.success('Код скопирован')).catch(()=>setError('Выделите и скопируйте код вручную'))}}>Скопировать приглашение</button>
 </>:modal==='delete-channel'?<p>Канал «{editingChannel?.channel.name}» и все его сообщения будут удалены без возможности восстановления.</p>:modal==='edit-group'?<>
 <label htmlFor="group-edit-name">Название группы</label>
 <input id="group-edit-name" autoFocus disabled={busy} required maxLength={60} value={name} onChange={e=>setName(e.target.value)}/>
 <section className="group-avatar-field">
  <label htmlFor="group-edit-avatar">Аватарка группы</label>
  <div className="group-avatar-editor">
   <span className="group-avatar-preview" aria-hidden="true">{groupAvatar?<img src={groupAvatar} alt=""/>:name.slice(0,2)}</span>
   <div>
    <input id="group-edit-avatar" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} aria-describedby="group-avatar-hint"
     onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void selectGroupAvatar(file)}}/>
    <p id="group-avatar-hint">PNG, JPEG или WebP до 5 МБ</p>
    {groupAvatar&&<Button type="button" size="sm" variant="ghost" disabled={busy} onClick={()=>{setAvatarDraft('');setError('')}}>Удалить аватарку</Button>}
   </div>
  </div>
 </section>
 <Button type="button" size="sm" variant="outline" disabled={busy} onClick={()=>setModal('group-stickers')}>Стикеры группы</Button>
 </>:<>{modal==='edit-channel'&&<label htmlFor="channel-edit-name">Название канала</label>}<input id={modal==='edit-channel'?'channel-edit-name':undefined} autoFocus disabled={busy} required={modal!=='dialog'} aria-label={modal==='join'?'Код приглашения':'Название'} placeholder={modal==='join'?'Код приглашения':'Название'} value={name} onChange={e=>setName(e.target.value)} maxLength={modal==='channel'||modal==='edit-channel'?40:60}/>{modal==='channel'&&<label className="channel-kind">Тип канала<Select label="Тип канала" value={channelKind} onValueChange={setChannelKind} options={[{value:'text',label:'Текстовый'},{value:'voice',label:'Голосовой с чатом'}]}/></label>}{modal==='dialog'&&<div style={{display:'block',maxHeight:220,overflow:'auto'}}>{state?.users.filter(u=>u.id!==state.me.id).map(u=><label key={u.id} style={{display:'flex',alignItems:'center',gap:10}}><input style={{width:18,margin:8}} type="checkbox" disabled={!selected.includes(u.id)&&selected.length>=9} checked={selected.includes(u.id)} onChange={e=>setSelected(e.target.checked?[...selected,u.id]:selected.filter(id=>id!==u.id))}/>{u.name}</label>)}{state?.users.length===1&&<p>Пока вы первый пользователь. Создайте второй аккаунт, чтобы начать диалог.</p>}</div>}</>}{error&&<p role="alert">{error}</p>}<div className={modal==='edit-channel'?'channel-settings-actions':undefined}>
 {modal==='edit-channel'&&<Button type="button" variant="destructive" size="sm" disabled={busy} onClick={()=>{setError('');setModal('delete-channel')}}>Удалить канал</Button>}
 <button type="button" disabled={busy} onClick={()=>{setModal(modal==='delete-channel'?'edit-channel':'');setError('')}}>{modal==='delete-channel'?'Отмена':'Закрыть'}</button>
 {modal==='delete-channel'&&<Button type="submit" variant="destructive" size="sm" disabled={busy}>{busy?'Удаление…':'Удалить канал'}</Button>}{modal==='invite'&&group?.owner===state?.me.id&&<button type="submit" className="small-button" disabled={busy||!name.trim()}>{busy?'Добавление…':'Пригласить'}</button>}{modal!=='invite'&&modal!=='bots'&&modal!=='delete-channel'&&modal!=='group-stickers'&&<button className="small-button" disabled={busy||(modal==='edit-group'&&(!name.trim()||(!groupAvatarChanged&&name.trim()===editingGroup?.name)))||(modal==='edit-channel'&&(!name.trim()||name.trim()===editingChannel?.channel.name))||(modal==='dialog'&&(!selected.length||selected.length>9))}>{modal==='edit-channel'||modal==='edit-group'?(busy?'Сохранение…':'Сохранить'):'Готово'}</button>}</div></form></div>}
 {profile&&state&&<UserProfile key={profile.id} user={profile} me={state.me} groups={state.groups} onClose={()=>setProfileId('')} onOpenGroup={id=>{setGroupId(id);setChannelId('');setHome(false)}}/>}
 </main>
 </UserActionsProvider>
}

