import {DialogListRow} from '@/features/conversation-list';
import {UnreadMentionBadge} from '@/entities/conversation';
import {VoiceConnectionPanel, VoiceInviteDialog, VoiceParticipants, VoiceQuickSettings} from '@/features/voice-room';
import {useRef, useState} from 'react';
import type {Voice} from '@/features/voice-room';
import {EntityContextMenu} from '@/shared/ui/entity-context-menu';
import {MotionIcon} from '@/shared/ui/motion-icon';
import {Button} from '@/shared/ui/button';
import {Input} from '@/shared/ui/input';
import {UserAvatar} from '@/shared/ui/user-avatar';
import {
 HeadphoneOff,
 Headphones,
 Home,
 LogOut,
 MessageCircle,
 Mic,
 MicOff,
 Plus,
 Search,
 Settings,
 ShieldCheck,
 UserPlus,
 Users,
 Volume2,
 X
} from 'lucide-react';
import type {Channel, ChatState} from '@/shared/types';
import type {ChatNavigationModel} from '../model/use-chat-navigation';
import type {ChatPanelsModel} from '../model/use-chat-panels';
import type {ChatCallsModel} from '../model/use-chat-calls';
import {ChatGroupHeader} from './chat-group-header';
import {
 callRoomName,
 dialogEmptyText,
 dialogName,
 dialogPeer,
 incomingFriendRequests,
 onlineText
} from '../model/chat-rules';

type Props = {
 state: ChatState | null;
 nav: ChatNavigationModel;
 panels: ChatPanelsModel;
 calls: ChatCallsModel;
 call: Voice;
};

/** Кнопка рейла групп: размер и форма одинаковы у «Домой», групп и создания. */
const serverClass = 'server relative h-10 min-h-10 w-10 rounded-[12px] text-[21px]';
const channelClass = 'channel hover:bg-transparent aria-[current=page]:font-semibold dark:hover:bg-transparent';
const channelRowClass =
 'channel-row hover:bg-muted/50 has-[[aria-current=page]]:bg-accent mb-px flex min-w-0 items-center rounded-lg';

/** Левая колонка страницы: рейл групп, список переписок и каналов, голос и профиль. */
export function ChatSidebar({state, nav, panels, calls, call}: Props) {
 const {home, group, channel, dialogs, dialogSearch, friends} = nav;
 const [inviteTarget, setInviteTarget] = useState<{group: string; channel: string}>();
 const inviteTrigger = useRef<HTMLButtonElement>(null);
 const groupChannels = group?.channels || [];
 const inviteChannel =
  !home && inviteTarget && group?.id === inviteTarget.group
   ? groupChannels.find(item => item.id === inviteTarget.channel && item.kind === 'voice')
   : undefined;
 const channelSettings = (target: Channel) =>
  nav.permits(group, 'channels.rename') || nav.permits(group, 'channels.delete') ? (
   <Button
    variant="ghost"
    size="icon-sm"
    type="button"
    className="channel-settings text-muted-foreground mr-[3px] h-7 w-7 shrink-0 rounded-[5px]"
    title="Настроить канал"
    aria-label={`Настроить канал ${target.name}`}
    onClick={() => panels.actions.startEditChannel(target)}
   >
    <MotionIcon icon={Settings} kind="settings" size={16} />
   </Button>
  ) : null;

 return (
  <>
   <aside className="channel-sidebar flex min-w-0 flex-1 flex-col rounded-tl-[10px] border border-b-0 [box-shadow:inset_1px_1px_0_#ffffff0d]">
    {home ? (
     <header className="dialog-search-header sidebar-header flex shrink-0 items-center gap-2 border-b px-2.5">
      <div className="relative min-w-0 flex-1">
       <Search
        aria-hidden="true"
        className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
       />
       <Input
        className="pr-8 pl-8"
        aria-label="Поиск переписок"
        placeholder="Поиск"
        value={dialogSearch}
        onChange={event => nav.actions.setDialogSearch(event.target.value)}
       />
       {dialogSearch && (
        <Button
         type="button"
         variant="ghost"
         size="icon-xs"
         className="absolute top-1/2 right-1 -translate-y-1/2"
         aria-label="Очистить поиск переписок"
         onClick={() => nav.actions.setDialogSearch('')}
        >
         <X />
        </Button>
       )}
      </div>
      <Button
       variant="ghost"
       size="icon-sm"
       type="button"
       className="new-dialog h-[30px] w-[26px] shrink-0 rounded-[8px]"
       title="Новый диалог"
       onClick={() => panels.actions.openModal('dialog')}
      >
       <Plus size={19} />
      </Button>
     </header>
    ) : (
     <ChatGroupHeader nav={nav} panels={panels} userId={state?.me.id} />
    )}
    <div className="channel-list flex-1 overflow-auto">
     {home ? (
      <>
       <Button
        type="button"
        variant="ghost"
        className={'friends-nav ' + (friends ? 'selected' : '')}
        aria-pressed={friends}
        onClick={() => nav.actions.selectChannel('friends')}
       >
        <Users size={20} />
        <span>Друзья</span>
        {!!incomingFriendRequests(state) && <small>{incomingFriendRequests(state)}</small>}
       </Button>
       <div className="category flex items-center gap-1">
        Личные сообщения
        <Button
         variant="ghost"
         size="icon-xs"
         className="ml-auto"
         type="button"
         title="Создать сообщение"
         aria-label="Создать сообщение"
         onClick={() => panels.actions.openModal('dialog')}
        >
         <Plus size={15} />
        </Button>
       </div>
       <div className="dialog-list flex flex-col gap-0.5" aria-label="Переписки">
        {state &&
         dialogs.map(dialog => {
          const row = nav.listRow(dialog);
          return (
           <DialogListRow
            readReceiptsSupported={state.readReceiptsSupported}
            key={dialog.id}
            dialog={dialog}
            name={dialogName(state, dialog)}
            peer={dialogPeer(state, dialog)}
            last={row.last}
            meId={state.me.id}
            active={dialog.id === channel?.id}
            preferences={row.preferences}
            busy={row.busy}
            onSelect={() => nav.actions.selectChannel(dialog.id)}
            onUpdate={patch => void nav.actions.changeDialogPreferences(dialog.id, patch)}
           />
          );
         })}
       </div>
       {!dialogs.length && (
        <p className="dialog-empty text-muted-foreground px-2 py-4 text-[13px] leading-[1.6]">
         {dialogEmptyText({search: dialogSearch, ready: !!state})}
        </p>
       )}
      </>
     ) : (
      <>
       <div className="category flex items-center gap-1">
        Текстовые каналы
        {nav.permits(group, 'channels.create_text') && (
         <Button
          variant="ghost"
          size="icon-xs"
          type="button"
          className="ml-auto"
          title="Добавить канал"
          onClick={() => panels.actions.openModal('channel')}
         >
          <Plus size={15} />
         </Button>
        )}
       </div>
       {groupChannels
        .filter(item => item.kind === 'text')
        .map(item => (
         <div className={channelRowClass} key={item.id}>
          <Button
           variant="ghost"
           size="default"
           type="button"
           aria-current={item.id === channel?.id ? 'page' : undefined}
           className={channelClass}
           onClick={() => nav.actions.selectChannel(item.id)}
          >
           <MessageCircle className="shrink-0" />
           <span className="truncate">{item.name}</span>
           <UnreadMentionBadge count={item.unreadMentionCount} />
          </Button>
          {channelSettings(item)}
         </div>
        ))}
       <div className="category flex items-center gap-1">
        Голосовые каналы
        {nav.permits(group, 'channels.create_voice') && (
         <Button
          variant="ghost"
          size="icon-xs"
          className="ml-auto"
          type="button"
          title="Добавить голосовой канал"
          aria-label="Добавить голосовой канал"
          onClick={() => {
           panels.actions.openModal('channel');
           panels.actions.setChannelKind('voice');
          }}
         >
          <Plus size={15} />
         </Button>
        )}
       </div>
       {groupChannels
        .filter(item => item.kind === 'voice')
        .map(item => (
         <div className="voice-channel" key={item.id}>
          <div className={channelRowClass}>
           <Button
            variant="ghost"
            size="default"
            type="button"
            aria-current={item.id === channel?.id ? 'page' : undefined}
            className={channelClass}
            key={item.id}
            onClick={() => nav.actions.selectChannel(item.id)}
            onDoubleClick={() => {
             nav.actions.selectChannel(item.id);
             if (call.room !== item.id && !call.busy) void call.join(item.id);
            }}
           >
            <Volume2 className="shrink-0" />
            <span className="truncate">{item.name}</span>
            <UnreadMentionBadge count={item.unreadMentionCount} />
           </Button>
           {group && (
            <Button
             type="button"
             variant="ghost"
             size="icon-xs"
             className="channel-settings text-muted-foreground"
             title="Пригласить в голосовой канал"
             aria-label={`Пригласить в голосовой канал «${item.name}»`}
             aria-haspopup="dialog"
             onClick={event => {
              inviteTrigger.current = event.currentTarget;
              setInviteTarget({group: group.id, channel: item.id});
             }}
            >
             <UserPlus />
            </Button>
           )}
           {channelSettings(item)}
          </div>
          <VoiceParticipants
           voice={call}
           room={item.id}
           title={item.name}
           me={state?.me}
           users={state?.users || []}
           presence={state?.voicePresence?.[item.id]}
           volumeForUser={calls.volumeForUser}
           setUserVolume={calls.setUserVolume}
          />
         </div>
        ))}
       {!group && <p>Создайте группу или вступите по приглашению.</p>}
      </>
     )}
    </div>
    {call.room && (
     <VoiceConnectionPanel
      voice={call}
      roomName={callRoomName(state, calls.calls, call.room)}
      onSettings={() => panels.actions.openSettings('voice')}
     />
    )}
   </aside>
   {state && group && inviteChannel && (
    <VoiceInviteDialog
     key={inviteChannel.id}
     group={group}
     channel={inviteChannel}
     users={state.users}
     ownId={state.me.id}
     onClose={() => setInviteTarget(undefined)}
     onRestoreFocus={() => inviteTrigger.current?.focus()}
    />
   )}
  </>
 );
}

export function ChatServerRail({state, nav, panels}: Pick<Props, 'state' | 'nav' | 'panels'>) {
 const {home, group} = nav;
 const groups = state?.groups || [];
 return (
  <nav
   className="server-rail flex w-[72px] shrink-0 [scrollbar-width:none] flex-col items-center gap-2 overflow-auto px-3"
   aria-label="Группы"
  >
   <Button
    variant="ghost"
    size="icon-lg"
    type="button"
    className={serverClass + ' ' + (home ? 'active' : '')}
    title="Личные сообщения"
    onClick={nav.actions.openHome}
   >
    <Home size={22} aria-hidden="true" />
   </Button>
   <div className="rail-line border-border w-7 border-t" />
   {state &&
    groups.map(g => (
     <EntityContextMenu
      key={g.id}
      actions={[
       ...(nav.canEdit(g)
        ? [{label: 'Настройки группы', icon: Settings, onSelect: () => panels.actions.editGroup(g)}]
        : []),
       {
        label: 'Роли и права',
        icon: ShieldCheck,
        onSelect: () => panels.actions.openRoles(g.id, 'roles')
       },
       ...(g.rolesRevision !== undefined && g.owner !== state.me.id
        ? [{label: 'Покинуть группу', icon: LogOut, onSelect: () => void nav.actions.leaveGroup(g)}]
        : [])
      ]}
     >
      <Button
       variant="ghost"
       size="icon-lg"
       type="button"
       className={serverClass + ' ' + (!home && group?.id === g.id ? 'active' : '')}
       title={g.name}
       aria-label={g.name}
       onClick={() => nav.actions.selectGroup(g.id)}
      >
       {g.avatar ? <img className="server-avatar" src={g.avatar} alt="" /> : g.name.slice(0, 2)}
      </Button>
     </EntityContextMenu>
    ))}
   <Button
    variant="ghost"
    size="icon-lg"
    type="button"
    className={serverClass}
    title="Создать группу"
    onClick={() => panels.actions.openModal('group')}
   >
    <Plus />
   </Button>
   <Button
    variant="ghost"
    size="icon-lg"
    type="button"
    className={serverClass}
    title="Вступить по приглашению"
    onClick={() => panels.actions.openModal('join')}
   >
    <Users />
   </Button>
  </nav>
 );
}

export function ChatProfileControls({state, panels, call}: Pick<Props, 'state' | 'panels' | 'call'>) {
 const microphoneOff = call.muted || call.deaf;
 return (
  <footer className="profile flex items-center border-t p-2">
   <Button
    variant="ghost"
    size="icon-xs"
    type="button"
    className="profile-self"
    title="Открыть свой профиль"
    onClick={() => state && panels.actions.openProfile(state.me.id)}
   >
    {state ? (
     <UserAvatar user={state.me} size="md" decoration={state.me.decorations?.avatar} />
    ) : (
     <span className="avatar" />
    )}
    <span className="profile-name min-w-0 flex-1">
     <strong>{state?.me.name || 'Загрузка…'}</strong>
     <small className="text-muted-foreground mt-[3px] block text-[11px]">{onlineText(state?.me.online)}</small>
    </span>
   </Button>
   <div className="voice-device-control">
    <Button
     type="button"
     variant="ghost"
     size="icon-sm"
     title={microphoneOff ? 'Включить микрофон' : 'Выключить микрофон'}
     aria-label="Микрофон"
     aria-pressed={microphoneOff}
     onClick={call.toggleMic}
    >
     {microphoneOff ? (
      <MotionIcon icon={MicOff} kind="device" size={18} className="text-red-400" />
     ) : (
      <MotionIcon icon={Mic} kind="device" size={18} />
     )}
    </Button>
    <VoiceQuickSettings voice={call} kind="input" onSettings={() => panels.actions.openSettings('voice')} />
   </div>
   <div className="voice-device-control">
    <Button
     type="button"
     variant="ghost"
     size="icon-sm"
     title={call.deaf ? 'Включить звук' : 'Отключить звук'}
     aria-label="Наушники"
     aria-pressed={call.deaf}
     onClick={call.toggleDeaf}
    >
     {call.deaf ? (
      <MotionIcon icon={HeadphoneOff} kind="device" size={18} className="text-red-400" />
     ) : (
      <MotionIcon icon={Headphones} kind="device" size={18} />
     )}
    </Button>
    <VoiceQuickSettings voice={call} kind="output" onSettings={() => panels.actions.openSettings('voice')} />
   </div>
   <Button
    variant="ghost"
    size="icon-xs"
    type="button"
    className="shrink-0"
    title="Настройки пользователя"
    onClick={panels.actions.openSettingsModal}
   >
    <MotionIcon icon={Settings} kind="settings" size={19} />
   </Button>
  </footer>
 );
}
