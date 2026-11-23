import {X} from 'lucide-react';
import './direct-message-notifications.css';
import type {NotificationTarget} from '../model/notification-target';

export type DirectMessage = {
 sender: string;
 text: string;
 avatar?: string | null;
 target?: NotificationTarget;
};

/** Кнопка закрытия: своя сетка и палитра, поэтому класс у неё отдельный. */
const closeButtonClass =
 'grid h-[22px] cursor-pointer place-items-center rounded-[5px] border-0 bg-transparent p-0 text-[#aebed2] hover:bg-[#dce6fa18] hover:text-[#eef3fc] focus-visible:outline-2 focus-visible:outline-[#aebed2]';
/** Кнопка «открыть чат» растянута под всю карточку и не перекрывает крестик. */
const openButtonClass =
 'absolute inset-y-0 right-8 left-0 h-auto w-auto rounded-[12px] bg-transparent hover:bg-transparent active:bg-transparent focus-visible:outline-2 focus-visible:outline-[#aebed2] focus-visible:outline-offset-[-3px]';

export function DirectMessageToast({
 sender,
 text,
 avatar,
 onClose,
 onOpen
}: DirectMessage & {onClose: () => void; onOpen?: () => void}) {
 const localAvatar = avatar && /^data:image\/(?:png|jpeg|webp);base64,/.test(avatar) ? avatar : undefined;

 return (
  <article className="direct-message-toast relative box-border grid w-[min(322px,calc(100vw-32px))] grid-cols-[48px_minmax(0,1fr)_22px] items-start gap-2.5 rounded-[12px] border border-[#dce6fa24] bg-[#1c2633] p-2.5 text-[#eef3fc] shadow-[0_8px_28px_#0005] focus-within:bg-[#243141] hover:bg-[#243141]">
   <span
    className="grid size-12 place-items-center overflow-hidden rounded-[50%] bg-[#3d5068] font-semibold"
    aria-hidden="true"
   >
    {localAvatar ? <img className="size-full object-cover" src={localAvatar} alt="" /> : [...sender][0]}
   </span>
   <div>
    <strong className="block truncate text-[13px]">{sender}</strong>
    <p className="mt-[3px] mb-0 line-clamp-2 text-[12px] leading-[1.35] [overflow-wrap:anywhere] text-[#aebed2]">
     {text}
    </p>
   </div>
   {onOpen && (
    <button type="button" className={openButtonClass} aria-label={`Открыть чат: ${sender}`} onClick={onOpen} />
   )}
   <button type="button" className={closeButtonClass} aria-label="Закрыть уведомление" onClick={onClose}>
    <X size={16} aria-hidden="true" />
   </button>
  </article>
 );
}
