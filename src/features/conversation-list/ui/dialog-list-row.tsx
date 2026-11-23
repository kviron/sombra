import {Bell, BellOff, Pin, PinOff} from 'lucide-react';
import type {ChatMessage, Dialog, DialogPreferences, User} from '@/shared/types';
import {EntityContextMenu} from '@/shared/ui/entity-context-menu';
import {UserRow} from '@/entities/user';
import {UnreadMentionBadge} from '@/entities/conversation';

export function DialogListRow({
 dialog,
 name,
 peer,
 last,
 meId,
 active,
 preferences,
 busy,
 onSelect,
 onUpdate,
 readReceiptsSupported = false
}: {
 readReceiptsSupported?: boolean;
 meId: string;
 dialog: Dialog;
 name: string;
 peer?: User;
 last?: ChatMessage;
 active: boolean;
 preferences: DialogPreferences;
 busy: boolean;
 onSelect: () => void;
 onUpdate: (patch: Partial<DialogPreferences>) => void;
}) {
 const actions = [
  {
   label: preferences.muted ? 'Включить уведомления' : 'Отключить уведомления',
   icon: preferences.muted ? Bell : BellOff,
   disabled: busy,
   separator: !!peer,
   onSelect: () => onUpdate({muted: !preferences.muted})
  },
  {
   label: preferences.pinned ? 'Открепить чат' : 'Закрепить чат',
   icon: preferences.pinned ? PinOff : Pin,
   disabled: busy,
   onSelect: () => onUpdate({pinned: !preferences.pinned})
  }
 ];
 const row = (
  <UserRow
   as="button"
   variant="dialog"
   className={'dialog-row ' + (active ? 'selected' : '')}
   selected={active}
   identity={peer || {id: dialog.id, name, avatar: dialog.members.length > 2 ? dialog.avatar : undefined}}
   subtitle={
    last
     ? `${last.user === meId ? 'Вы: ' : ''}${last.text || (last.attachment ? `Файл: ${last.attachment.name}` : last.sticker ? 'Стикер' : '')}`
     : 'Нет сообщений'
   }
   meta={
    <>
     <UnreadMentionBadge count={dialog.unreadMentionCount} />
     {readReceiptsSupported && (dialog.unreadCount || 0) > 0 && (
      <span
       className="bg-primary text-primary-foreground inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-[5px] text-[11px] font-semibold whitespace-nowrap"
       title={`Непрочитанных сообщений: ${dialog.unreadCount}`}
       aria-label={`Непрочитанных сообщений: ${dialog.unreadCount}`}
      >
       {dialog.unreadCount! > 99 ? '99+' : dialog.unreadCount}
      </span>
     )}
     {(preferences.pinned || preferences.muted) && (
      <span className="inline-flex shrink-0 items-center gap-[5px] text-[#b8c4dc] [&_svg]:shrink-0">
       {preferences.pinned && (
        <span role="img" aria-label="Закреплённый чат" title="Закреплённый чат">
         <Pin size={12} />
        </span>
       )}
       {preferences.muted && (
        <span role="img" aria-label="Уведомления отключены" title="Уведомления отключены">
         <BellOff size={12} />
        </span>
       )}
      </span>
     )}
     {last && (
      <time dateTime={new Date(last.time * 1000).toISOString()}>
       {new Date(last.time * 1000).toLocaleDateString() === new Date().toLocaleDateString()
        ? new Date(last.time * 1000).toLocaleTimeString('ru', {hour: '2-digit', minute: '2-digit'})
        : new Date(last.time * 1000).toLocaleDateString('ru', {day: 'numeric', month: 'short'})}
      </time>
     )}
    </>
   }
   onClick={onSelect}
   menu={!!peer}
   presence={!!peer}
   actions={peer ? actions : undefined}
  />
 );
 const entry = (
  <div
   className="dialog-list-entry"
   data-dialog-id={dialog.id}
   data-pinned={preferences.pinned || undefined}
   data-muted={preferences.muted || undefined}
  >
   {row}
  </div>
 );
 return peer ? entry : <EntityContextMenu actions={actions}>{entry}</EntityContextMenu>;
}
