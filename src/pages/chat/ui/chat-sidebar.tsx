import {DialogListRow} from '@/features/conversation-list';
import {UnreadMentionBadge} from '@/entities/conversation';
import {VoiceParticipants, VoiceQuickSettings} from '@/features/voice-room';
import type {Voice} from '@/features/voice-room';
import {ColumnResizer} from '@/shared/ui/column-resizer';
import {EntityContextMenu} from '@/shared/ui/entity-context-menu';
import {MotionIcon} from '@/shared/ui/motion-icon';
import {Button} from '@/shared/ui/button';
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
 Users,
 Volume2,
 X
} from 'lucide-react';
import type {Channel, ChatState} from '@/shared/types';
import type {ChatNavigationModel} from '../model/use-chat-navigation';
import type {ChatPanelsModel} from '../model/use-chat-panels';
import type {ChatCallsModel} from '../model/use-chat-calls';
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

/** Левая колонка страницы: рейл групп, список переписок и каналов, голос и профиль. */
export function ChatSidebar({state, nav, panels, calls, call}: Props) {
 const {home, group, channel, dialogs, dialogSearch, friends} = nav;
 const groups = state?.groups || [];
 const groupChannels = group?.channels || [];
 const microphoneOff = call.muted || call.deaf;
 const channelSettings = (target: Channel) =>
  nav.permits(group, 'channels.rename') || nav.permits(group, 'channels.delete') ? (
   <button
    type="button"
    className="channel-settings"
    title="Настроить канал"
    aria-label={`Настроить канал ${target.name}`}
    onClick={() => panels.actions.startEditChannel(target)}
   >
    <MotionIcon icon={Settings} kind="settings" size={16} />
   </button>
  ) : null;

 return (
  <>
   <nav className="server-rail" aria-label="Группы">
    <button className={'server ' + (home ? 'active' : '')} title="Личные сообщения" onClick={nav.actions.openHome}>
     <Home size={22} aria-hidden="true" />
    </button>
    <div className="rail-line" />
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
       <button
        className={'server ' + (!home && group?.id === g.id ? 'active' : '')}
        title={g.name}
        aria-label={g.name}
        onClick={() => nav.actions.selectGroup(g.id)}
       >
        {g.avatar ? <img className="server-avatar" src={g.avatar} alt="" /> : g.name.slice(0, 2)}
       </button>
      </EntityContextMenu>
     ))}
    <button className="server" title="Создать группу" onClick={() => panels.actions.openModal('group')}>
     <Plus />
    </button>
    <button className="server" title="Вступить по приглашению" onClick={() => panels.actions.openModal('join')}>
     <Users />
    </button>
   </nav>
   <aside className="channel-sidebar">
    <ColumnResizer label="Ширина списка каналов" side="right" variable="--channel-width" min={190} max={480} />
    {home ? (
     <header className="dialog-search-header">
      <label className="dialog-search">
       <Search size={17} />
       <input
        aria-label="Поиск переписок"
        placeholder="Поиск"
        value={dialogSearch}
        onChange={event => nav.actions.setDialogSearch(event.target.value)}
       />
       {dialogSearch && (
        <button aria-label="Очистить поиск переписок" onClick={() => nav.actions.setDialogSearch('')}>
         <X size={15} />
        </button>
       )}
      </label>
      <button className="new-dialog" title="Новый диалог" onClick={() => panels.actions.openModal('dialog')}>
       <Plus size={19} />
      </button>
     </header>
    ) : (
     <header className="group-header">
      <strong title={group?.name}>{group?.name || 'Ваши группы'}</strong>
      <button title="Новый диалог" onClick={() => panels.actions.openModal('dialog')}>
       <Plus size={19} />
      </button>
      {group && nav.canEdit(group) && (
       <button
        type="button"
        className="group-settings-button"
        title="Настройки группы"
        aria-label="Настройки группы"
        onClick={() => panels.actions.editGroup(group)}
       >
        <MotionIcon icon={Settings} kind="settings" size={17} />
       </button>
      )}
      {group && (
       <button
        type="button"
        className="group-roles-button"
        title="Роли и права"
        aria-label="Роли и права группы"
        onClick={() => panels.actions.openRoles(group.id, 'roles')}
       >
        <ShieldCheck size={17} />
       </button>
      )}
     </header>
    )}
    <div className="channel-list">
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
       <div className="category">
        Личные сообщения
        <button
         type="button"
         title="Создать сообщение"
         aria-label="Создать сообщение"
         onClick={() => panels.actions.openModal('dialog')}
        >
         <Plus size={15} />
        </button>
       </div>
       <div className="dialog-list" aria-label="Переписки">
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
       {!dialogs.length && <p className="dialog-empty">{dialogEmptyText({search: dialogSearch, ready: !!state})}</p>}
      </>
     ) : (
      <>
       {group && (nav.permits(group, 'members.invite') || nav.permits(group, 'invite.rotate')) && (
        <button className="channel" onClick={() => panels.actions.openModal('invite')}>
         <Users />
         Пригласить участников
        </button>
       )}
       <div className="category">
        Текстовые каналы
        {nav.permits(group, 'channels.create_text') && (
         <button title="Добавить канал" onClick={() => panels.actions.openModal('channel')}>
          <Plus size={15} />
         </button>
        )}
       </div>
       {groupChannels
        .filter(item => item.kind === 'text')
        .map(item => (
         <div className={'channel-row ' + (item.id === channel?.id ? 'selected' : '')} key={item.id}>
          <button
           className={'channel ' + (item.id === channel?.id ? 'selected' : '')}
           onClick={() => nav.actions.selectChannel(item.id)}
          >
           <MessageCircle />
           <span>{item.name}</span>
           <UnreadMentionBadge count={item.unreadMentionCount} />
          </button>
          {channelSettings(item)}
         </div>
        ))}
       <div className="category">
        Голосовые каналы
        {nav.permits(group, 'channels.create_voice') && (
         <button
          type="button"
          title="Добавить голосовой канал"
          aria-label="Добавить голосовой канал"
          onClick={() => {
           panels.actions.openModal('channel');
           panels.actions.setChannelKind('voice');
          }}
         >
          <Plus size={15} />
         </button>
        )}
       </div>
       {groupChannels
        .filter(item => item.kind === 'voice')
        .map(item => (
         <div className="voice-channel" key={item.id}>
          <div className={'channel-row ' + (item.id === channel?.id ? 'selected' : '')}>
           <button
            className={'channel ' + (item.id === channel?.id ? 'selected' : '')}
            key={item.id}
            onClick={() => nav.actions.selectChannel(item.id)}
            onDoubleClick={() => {
             nav.actions.selectChannel(item.id);
             if (call.room !== item.id && !call.busy) void call.join(item.id);
            }}
           >
            <Volume2 />
            <span>{item.name}</span>
            <UnreadMentionBadge count={item.unreadMentionCount} />
           </button>
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
     <div className="voice-status">
      Голосовая связь · {callRoomName(state, calls.calls, call.room)}
      <button onClick={call.leave}>Отключиться</button>
     </div>
    )}
    <footer className="profile">
     <button
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
      <span className="profile-name">
       <strong>{state?.me.name || 'Загрузка…'}</strong>
       <small>{onlineText(state?.me.online)}</small>
      </span>
     </button>
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
     <button title="Настройки пользователя" onClick={panels.actions.openSettingsModal}>
      <MotionIcon icon={Settings} kind="settings" size={19} />
     </button>
    </footer>
   </aside>
  </>
 );
}
