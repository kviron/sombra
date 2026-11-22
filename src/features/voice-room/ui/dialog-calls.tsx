import {Dialog as DialogPrimitive} from 'radix-ui';
import {Phone, PhoneOff, Video, Users} from 'lucide-react';
import {type ChatState, type DialogCall} from '@/shared/types';
import {Button} from '@/shared/ui/button';
import {UserAvatar} from '@/shared/ui/user-avatar';
import './dialog-calls.css';

export function DialogCallBanner({
 call,
 joined,
 busy,
 onJoin,
 onLeave
}: {
 call: DialogCall;
 joined: boolean;
 busy: boolean;
 onJoin: () => void;
 onLeave: () => void;
}) {
 return (
  <div className="dialog-call-banner" role="status">
   <span className="dialog-call-banner-icon">{call.video ? <Video size={18} /> : <Phone size={18} />}</span>
   <div>
    <strong>{joined ? 'Вы в звонке' : 'В диалоге идёт звонок'}</strong>
    <small>
     {call.participants.length ? `На связи: ${call.participants.length}` : 'Ожидание участников'} ·{' '}
     {call.video ? 'Видео' : 'Аудио'}
    </small>
   </div>
   <Button
    type="button"
    size="sm"
    variant={joined ? 'destructive' : 'secondary'}
    disabled={busy}
    onClick={joined ? onLeave : onJoin}
   >
    {joined ? 'Выйти' : 'Присоединиться'}
   </Button>
  </div>
 );
}

export function IncomingDialogCall({
 call,
 state,
 busy,
 declining = busy,
 error,
 hasOtherVoice = false,
 onAccept,
 onDecline
}: {
 call: DialogCall;
 state: ChatState;
 busy: boolean;
 declining?: boolean;
 error: string;
 hasOtherVoice?: boolean;
 onAccept: (video: boolean) => void;
 onDecline: () => void;
}) {
 const caller = state.users.find(user => user.id === call.caller);
 const dialog = state.dialogs.find(item => item.id === call.dialog);
 const group = !!dialog && dialog.members.length > 2;
 return (
  <DialogPrimitive.Root
   open
   modal={false}
   onOpenChange={open => {
    if (!open) onDecline();
   }}
  >
   <DialogPrimitive.Portal>
    <DialogPrimitive.Content
     className="incoming-dialog-call"
     data-call-id={call.id}
     aria-busy={busy}
     onOpenAutoFocus={event => event.preventDefault()}
     onCloseAutoFocus={event => event.preventDefault()}
     onInteractOutside={event => event.preventDefault()}
     onEscapeKeyDown={event => {
      event.preventDefault();
      onDecline();
     }}
    >
     <button type="button" className="incoming-call-close" aria-label="Отклонить звонок" onClick={onDecline}>
      ×
     </button>
     {caller ? <UserAvatar user={caller} size="xl" decoration={caller.decorations?.avatar} /> : <Users size={48} />}
     <DialogPrimitive.Title>{caller?.name || 'Участник Sombra'}</DialogPrimitive.Title>
     <DialogPrimitive.Description>
      {group ? 'Входящий групповой ' : 'Входящий '}
      {call.video ? 'видеозвонок' : 'аудиозвонок'}
      {group && dialog?.name ? ` · ${dialog.name}` : ''}
     </DialogPrimitive.Description>
     {group && (
      <p className="incoming-call-members">Приглашены все участники диалога · {dialog.members.length} человек</p>
     )}
     {hasOtherVoice && (
      <p className="incoming-call-switch">
       Ответ завершит текущее голосовое подключение. Отклонение оставит его без изменений.
      </p>
     )}
     {error && (
      <p role="alert" className="incoming-call-error">
       {error}
      </p>
     )}
     <div className="incoming-call-actions">
      <Button type="button" variant="destructive" data-call-action="decline" disabled={declining} onClick={onDecline}>
       <PhoneOff size={18} />
       Отклонить
      </Button>
      <Button
       type="button"
       className="accept-call"
       data-call-action="accept"
       disabled={busy}
       onClick={() => onAccept(call.video)}
      >
       {call.video ? <Video size={18} /> : <Phone size={18} />}
       {hasOtherVoice ? 'Выйти и ответить' : 'Ответить'}
      </Button>
     </div>
     {call.video && (
      <Button type="button" variant="ghost" disabled={busy} onClick={() => onAccept(false)}>
       Ответить без камеры
      </Button>
     )}
    </DialogPrimitive.Content>
   </DialogPrimitive.Portal>
  </DialogPrimitive.Root>
 );
}
