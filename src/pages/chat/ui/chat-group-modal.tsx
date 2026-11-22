import {toast} from 'sonner';
import {StickerLibrary} from '@/entities/sticker';
import {Select} from '@/shared/ui/select';
import {Button} from '@/shared/ui/button';
import type {ChatState} from '@/shared/types';
import {Bots} from './bots';
import type {ChatNavigationModel} from '../model/use-chat-navigation';
import type {ChatPanelsModel} from '../model/use-chat-panels';
import type {ChatStateModel} from '../model/use-chat-state';
import {modalDoneDisabled, modalTitle, selectionFull} from '../model/chat-rules';

type Props = {
 chat: ChatStateModel;
 state: ChatState | null;
 nav: ChatNavigationModel;
 panels: ChatPanelsModel;
};

/** Общее окно действий: группа, канал, диалог, приглашение, боты и стикеры группы. */
export function ChatGroupModal({chat, state, nav, panels}: Props) {
 const {modal, name, selected, channelKind, editingChannel, editingGroup, editingGroupData, editingChannelGroup} =
  panels;
 if (!modal || modal === 'dialog' || modal === 'edit-group') return null;
 const {group, channel} = nav;
 const permits = panels.permissions;
 const canCreateText = permits(group, 'channels.create_text');
 const canCreateVoice = permits(group, 'channels.create_voice');
 return (
  <div className="modal-backdrop">
   <form
    className="group-modal"
    role="dialog"
    aria-modal="true"
    aria-label={
     modal === 'delete-channel' ? 'Удалить канал' : modal === 'edit-group' ? 'Настройки группы' : 'Управление чатами'
    }
    onSubmit={event => {
     event.preventDefault();
     void panels.actions.submit();
    }}
   >
    <h2>{modalTitle(modal)}</h2>
    {modal === 'group-stickers' && state && editingGroup ? (
     permits(editingGroupData, 'stickers.manage') ? (
      <StickerLibrary
       stickers={state.stickers}
       user={state.me.id}
       group={editingGroup.id}
       refresh={chat.actions.refresh}
      />
     ) : (
      <p role="status">Нет права управлять стикерами этой группы.</p>
     )
    ) : modal === 'bots' && state && channel ? (
     <Bots
      state={state}
      refresh={chat.actions.refresh}
      onError={chat.actions.setError}
      channel={channel.id}
      group={group?.id}
      owner={permits(group, 'bots.manage')}
     />
    ) : modal === 'invite' ? (
     <>
      {permits(group, 'members.invite') && (
       <>
        <label htmlFor="invite-email">Email аккаунта Sombra</label>
        <input
         id="invite-email"
         type="email"
         autoComplete="off"
         autoFocus
         required
         disabled={chat.busy}
         maxLength={254}
         value={name}
         onChange={event => {
          panels.actions.setName(event.target.value);
          chat.actions.clearError();
         }}
        />
       </>
      )}
      {permits(group, 'members.invite') && !!group?.invite && (
       <>
        <p>Код приглашения</p>
        <input readOnly aria-label="Код приглашения" value={group?.invite || ''} />
        <button
         type="button"
         className="small-button"
         onClick={() => {
          if (!permits(group, 'members.invite') || !group?.invite) return;
          void navigator.clipboard
           .writeText(group.invite)
           .then(() => toast.success('Код скопирован'))
           .catch(() => chat.actions.setError('Выделите и скопируйте код вручную'));
         }}
        >
         Скопировать приглашение
        </button>
       </>
      )}
      {group?.rolesRevision !== undefined && permits(group, 'invite.rotate') && (
       <Button type="button" variant="outline" disabled={chat.busy} onClick={() => void nav.actions.rotateInvite()}>
        Заменить код приглашения
       </Button>
      )}
     </>
    ) : modal === 'delete-channel' ? (
     <p>Канал «{editingChannel?.channel.name}» и все его сообщения будут удалены без возможности восстановления.</p>
    ) : (
     <>
      {modal === 'edit-channel' && <label htmlFor="channel-edit-name">Название канала</label>}
      <input
       id={modal === 'edit-channel' ? 'channel-edit-name' : undefined}
       autoFocus
       disabled={chat.busy || (modal === 'edit-channel' && !permits(editingChannelGroup, 'channels.rename'))}
       required={modal !== 'dialog'}
       aria-label={modal === 'join' ? 'Код приглашения' : 'Название'}
       placeholder={modal === 'join' ? 'Код приглашения' : 'Название'}
       value={name}
       onChange={event => panels.actions.setName(event.target.value)}
       maxLength={modal === 'channel' || modal === 'edit-channel' ? 40 : 60}
      />
      {modal === 'channel' && (
       <label className="channel-kind">
        Тип канала
        <Select
         label="Тип канала"
         value={channelKind}
         onValueChange={panels.actions.setChannelKind}
         options={[
          ...(canCreateText ? [{value: 'text', label: 'Текстовый'}] : []),
          ...(canCreateVoice ? [{value: 'voice', label: 'Голосовой с чатом'}] : [])
         ]}
        />
       </label>
      )}
      {modal === 'dialog' && (
       <div style={{display: 'block', maxHeight: 220, overflow: 'auto'}}>
        {state &&
         state.users
          .filter(user => user.id !== state.me.id)
          .map(user => (
           <label key={user.id} style={{display: 'flex', alignItems: 'center', gap: 10}}>
            <input
             style={{width: 18, margin: 8}}
             type="checkbox"
             disabled={selectionFull(selected, user.id)}
             checked={selected.includes(user.id)}
             onChange={event => panels.actions.toggleSelected(user.id, event.target.checked)}
            />
            {user.name}
           </label>
          ))}
        {state?.users.length === 1 && <p>Пока вы первый пользователь. Создайте второй аккаунт, чтобы начать диалог.</p>}
       </div>
      )}
     </>
    )}
    {chat.error && <p role="alert">{chat.error}</p>}
    <div className={modal === 'edit-channel' ? 'channel-settings-actions' : undefined}>
     {modal === 'edit-channel' && permits(editingChannelGroup, 'channels.delete') && (
      <Button
       type="button"
       variant="destructive"
       size="sm"
       disabled={chat.busy}
       onClick={panels.actions.startDeleteChannel}
      >
       Удалить канал
      </Button>
     )}
     <button
      type="button"
      disabled={chat.busy}
      onClick={() => {
       chat.actions.clearError();
       if (modal === 'delete-channel') panels.actions.backToEditChannel();
       else panels.actions.closeModal();
      }}
     >
      {modal === 'delete-channel' ? 'Отмена' : 'Закрыть'}
     </button>
     {modal === 'delete-channel' && (
      <Button
       type="submit"
       variant="destructive"
       size="sm"
       disabled={chat.busy || !permits(editingChannelGroup, 'channels.delete')}
      >
       {chat.busy ? 'Удаление…' : 'Удалить канал'}
      </Button>
     )}
     {modal === 'invite' && permits(group, 'members.invite') && (
      <button type="submit" className="small-button" disabled={chat.busy || !name.trim()}>
       {chat.busy ? 'Добавление…' : 'Пригласить'}
      </button>
     )}
     {modal !== 'invite' &&
      modal !== 'bots' &&
      modal !== 'delete-channel' &&
      modal !== 'group-stickers' &&
      (modal !== 'edit-channel' || permits(editingChannelGroup, 'channels.rename')) && (
       <button
        className="small-button"
        disabled={modalDoneDisabled({
         mode: modal,
         busy: chat.busy,
         name,
         selected,
         channelKind,
         editingChannelName: editingChannel?.channel.name,
         canCreateText,
         canCreateVoice
        })}
       >
        {modal === 'edit-channel' ? (chat.busy ? 'Сохранение…' : 'Сохранить') : 'Готово'}
       </button>
      )}
    </div>
   </form>
  </div>
 );
}
