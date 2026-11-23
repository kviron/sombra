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
  <div
   className="dialog-call-banner flex items-center gap-3 border-b border-b-[#71c8a32b] bg-[#163d3038] px-4 py-3 text-[#d8efe5]"
   role="status"
  >
   <span className="dialog-call-banner-icon grid size-[34px] place-items-center rounded-[50%] bg-[#60d49d20] text-[#77dcb0]">
    {call.video ? <Video size={18} /> : <Phone size={18} />}
   </span>
   <div className="min-w-0 flex-1">
    <strong className="block text-[13px]">{joined ? 'Вы в звонке' : 'В диалоге идёт звонок'}</strong>
    <small className="mt-[3px] block text-[12px] text-[#a1bcaf]">
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
     className="incoming-dialog-call fixed right-4 bottom-4 z-[131] flex max-h-[calc(100vh-64px)] w-[min(420px,calc(100vw-32px))] flex-col items-center gap-3.5 overflow-auto rounded-[18px] border border-[#ffffff26] bg-[#191e29] px-6 py-8 text-center text-[#edf1f8] [box-shadow:0_24px_80px_#0009]"
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
     <button
      type="button"
      className="incoming-call-close absolute top-2 right-2 grid size-11 place-items-center rounded-[8px] bg-transparent text-[25px] text-[#c2ccdf] [border:0] hover:bg-[#ffffff12] focus-visible:outline-2 focus-visible:outline-[#77dcb0] disabled:cursor-wait disabled:opacity-50"
      aria-label="Отклонить звонок"
      onClick={onDecline}
     >
      ×
     </button>
     {caller ? <UserAvatar user={caller} size="xl" decoration={caller.decorations?.avatar} /> : <Users size={48} />}
     <DialogPrimitive.Title className="max-w-full text-[23px] [font-weight:650] [overflow-wrap:anywhere]">
      {caller?.name || 'Участник Sombra'}
     </DialogPrimitive.Title>
     <DialogPrimitive.Description className="text-[14px] leading-[1.5] text-[#aeb8cb]">
      {group ? 'Входящий групповой ' : 'Входящий '}
      {call.video ? 'видеозвонок' : 'аудиозвонок'}
      {group && dialog?.name ? ` · ${dialog.name}` : ''}
     </DialogPrimitive.Description>
     {group && (
      <p className="incoming-call-members text-[12px] leading-[1.5] text-[#aeb8cb]">
       Приглашены все участники диалога · {dialog.members.length} человек
      </p>
     )}
     {hasOtherVoice && (
      <p className="incoming-call-switch max-w-[32ch] text-[14px] leading-[1.5] text-[#aeb8cb]">
       Ответ завершит текущее голосовое подключение. Отклонение оставит его без изменений.
      </p>
     )}
     {error && (
      <p role="alert" className="incoming-call-error text-[12px] leading-[1.5] text-[#ffb8bb]">
       {error}
      </p>
     )}
     <div className="incoming-call-actions mt-3 flex flex-wrap justify-center gap-3">
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
