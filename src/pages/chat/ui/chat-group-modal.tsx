import {toast} from 'sonner';
import {useState} from 'react';
import {StickerLibrary} from '@/entities/sticker';
import {UserRow} from '@/entities/user';
import {Checkbox} from '@/shared/ui/checkbox';
import {Input} from '@/shared/ui/input';
import {OptionsSelect} from '@/shared/ui/select';
import {Button} from '@/shared/ui/button';
import type {ChatState} from '@/shared/types';
import {Bots} from './bots';
import type {ChatNavigationModel} from '../model/use-chat-navigation';
import type {ChatPanelsModel} from '../model/use-chat-panels';
import type {ChatStateModel} from '../model/use-chat-state';
import {groupInviteCandidates, modalDoneDisabled, modalTitle, selectionFull} from '../model/chat-rules';

type Props = {
 chat: ChatStateModel;
 state: ChatState | null;
 nav: ChatNavigationModel;
 panels: ChatPanelsModel;
};

function InvitePeople({
 candidates,
 selected,
 disabled,
 toggle
}: {
 candidates: ReturnType<typeof groupInviteCandidates>;
 selected: string[];
 disabled: boolean;
 toggle: (id: string, checked: boolean) => void;
}) {
 const [query, setQuery] = useState('');
 const search = query.trim().toLocaleLowerCase('ru');
 const visible = candidates
  .filter(user => user.name.toLocaleLowerCase('ru').includes(search))
  .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
 return (
  <section aria-label="Выбор участников">
   {candidates.length > 0 && (
    <Input
     type="search"
     aria-label="Поиск пользователей"
     placeholder="Поиск по имени"
     className="mb-2"
     value={query}
     onChange={event => setQuery(event.target.value)}
    />
   )}
   {visible.length ? (
    <ul className="m-0 grid max-h-56 list-none gap-1 overflow-auto p-0">
     {visible.map(user => (
      <li key={user.id} className="hover:bg-accent flex items-center justify-between gap-2 rounded-lg pr-3">
       <UserRow identity={user} menu={false} />
       <Checkbox
        aria-label={`Выбрать ${user.name}`}
        checked={selected.includes(user.id)}
        disabled={disabled || selectionFull(selected, user.id)}
        onCheckedChange={checked => toggle(user.id, checked === true)}
       />
      </li>
     ))}
    </ul>
   ) : (
    <p className="text-muted-foreground text-sm">
     {candidates.length ? 'По этому имени никого не нашли.' : 'Все доступные пользователи уже в группе.'}
    </p>
   )}
  </section>
 );
}

/** Общее окно действий: группа, канал, диалог, приглашение, боты и стикеры группы. */
export function ChatGroupModal({chat, state, nav, panels}: Props) {
 const {modal, name, selected, channelKind, editingChannel, editingGroup, editingGroupData, editingChannelGroup} =
  panels;
 if (!modal || modal === 'dialog' || modal === 'edit-group') return null;
 const {group, channel} = nav;
 const permits = panels.permissions;
 const canCreateText = permits(group, 'channels.create_text');
 const canCreateVoice = permits(group, 'channels.create_voice');
 const inviteCandidates = modal === 'invite' && group && state ? groupInviteCandidates(state.users, group.members) : [];
 const inviteSelection = selected.filter(id => inviteCandidates.some(user => user.id === id));
 return (
  <div className="modal-backdrop">
   <form
    className="group-modal max-h-[85dvh] w-full overflow-auto border"
    role="dialog"
    aria-modal="true"
    aria-label={modalTitle(modal)}
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
        <InvitePeople
         candidates={inviteCandidates}
         selected={inviteSelection}
         disabled={chat.busy}
         toggle={panels.actions.toggleSelected}
        />
        <label className="mt-3 block" htmlFor="invite-email">
         Или пригласите по email
        </label>
        <Input
         id="invite-email"
         type="email"
         autoComplete="off"
         disabled={chat.busy || inviteSelection.length > 0}
         maxLength={254}
         className="my-2"
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
        <Input readOnly aria-label="Код приглашения" className="my-2" value={group?.invite || ''} />
        <Button
         type="button"
         size="sm"
         variant="outline"
         onClick={() => {
          if (!permits(group, 'members.invite') || !group?.invite) return;
          void navigator.clipboard
           .writeText(group.invite)
           .then(() => toast.success('Код скопирован'))
           .catch(() => chat.actions.setError('Выделите и скопируйте код вручную'));
         }}
        >
         Скопировать приглашение
        </Button>
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
      <Input
       id={modal === 'edit-channel' ? 'channel-edit-name' : undefined}
       autoFocus
       disabled={chat.busy || (modal === 'edit-channel' && !permits(editingChannelGroup, 'channels.rename'))}
       required
       className="my-2"
       aria-label={modal === 'join' ? 'Код приглашения' : 'Название'}
       placeholder={modal === 'join' ? 'Код приглашения' : 'Название'}
       value={name}
       onChange={event => panels.actions.setName(event.target.value)}
       maxLength={modal === 'channel' || modal === 'edit-channel' ? 40 : 60}
      />
      {modal === 'channel' && (
       <label className="channel-kind">
        Тип канала
        <OptionsSelect
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
     </>
    )}
    {chat.error && <p role="alert">{chat.error}</p>}
    <div className={modal === 'edit-channel' ? 'channel-settings-actions' : 'mt-4 flex flex-wrap justify-end gap-2'}>
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
     <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={chat.busy}
      onClick={() => {
       chat.actions.clearError();
       if (modal === 'delete-channel') panels.actions.backToEditChannel();
       else panels.actions.closeModal();
      }}
     >
      {modal === 'delete-channel' ? 'Отмена' : 'Закрыть'}
     </Button>
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
      <Button type="submit" size="sm" disabled={chat.busy || (!name.trim() && inviteSelection.length === 0)}>
       {chat.busy ? 'Добавление…' : 'Пригласить'}
      </Button>
     )}
     {modal !== 'invite' &&
      modal !== 'bots' &&
      modal !== 'delete-channel' &&
      modal !== 'group-stickers' &&
      (modal !== 'edit-channel' || permits(editingChannelGroup, 'channels.rename')) && (
       <Button
        type="submit"
        size="sm"
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
       </Button>
      )}
    </div>
   </form>
  </div>
 );
}
