import {useEffect, useRef} from 'react';
import {Dialog as DialogPrimitive} from 'radix-ui';
import {Camera, ChevronRight, File, Headphones, Image, Link2, Pencil, Settings, Video, X} from 'lucide-react';
import {type ChatMessage, type ChatState, type Dialog, type User} from '@/shared/types';
import {conversationMaterials, type MaterialCategory} from '@/entities/message';
import {UserAvatar} from '@/shared/ui/user-avatar';
import {Button} from '@/shared/ui/button';
import {peerStatus} from '@/entities/conversation';
import {ImageCropDialog} from '@/shared/ui/image-crop-dialog';
import {cn} from '@/shared/lib';
import {useConversationInfo} from '../model/use-conversation-info';
import './conversation-info-dialog.css';

export function participantCount(count: number) {
 const mod = count % 100,
  last = count % 10;
 return `${count} ${mod >= 11 && mod <= 14 ? 'участников' : last === 1 ? 'участник' : last >= 2 && last <= 4 ? 'участника' : 'участников'}`;
}
const categories = [
 {id: 'photos', label: 'Фото', icon: Image},
 {id: 'videos', label: 'Видео', icon: Video},
 {id: 'files', label: 'Файлы', icon: File},
 {id: 'audio', label: 'Аудио', icon: Headphones},
 {id: 'links', label: 'Ссылки', icon: Link2}
] as const;
export type ProfileConversationMaterials = {
 messages: ChatMessage[];
 channel: string;
 onOpen: (category: MaterialCategory) => void;
};
export function ConversationMaterialRows({messages, channel, onOpen}: ProfileConversationMaterials) {
 const items = conversationMaterials(messages, channel);
 if (!items.length) return null;
 return (
  <section className="conversation-info-materials" aria-label="Материалы этой переписки">
   <h3 className="mt-4 mb-2 text-[13px] leading-[1.5] font-semibold text-[#b9b9c3]">Материалы переписки</h3>
   {categories
    .filter(({id}) => items.some(item => item.category === id))
    .map(({id, label, icon: Icon}) => (
     <button
      type="button"
      key={id}
      className="flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-[8px] border-0 bg-transparent px-2 py-2.5 text-left text-sm leading-[1.5] text-inherit hover:bg-[#ffffff08] [&>svg]:shrink-0 [&>svg]:text-[#adadb7]"
      data-material-category={id}
      onClick={() => onOpen(id)}
     >
      <Icon size={19} />
      <span className="flex-1">{label}</span>
      <small className="text-[13px] leading-[1.5] text-[#adadb7]">
       {items.filter(item => item.category === id).length}
      </small>
      <ChevronRight size={16} />
     </button>
    ))}
   <p className="m-2 text-xs leading-[1.5] text-[#a5a5af]">
    По сообщениям этой переписки. Недоступные вложения учитываются, если сохранились их метаданные.
   </p>
  </section>
 );
}
type Props = {
 state: ChatState;
 title: string;
 channel: string;
 memberIds: string[];
 avatar?: string;
 channelLabel?: string;
 dialog?: Dialog;
 onSaved?: (owner: string, dialog: Dialog) => Promise<void>;
 onClose: () => void;
 onProfile: (id: string) => void;
 onMaterials: (category: MaterialCategory) => void;
 onSettings?: () => void;
};

/**
 * Компонент только показывает: черновик, поиск участников и сохранение приходят
 * из модели среза, поэтому здесь нет ни запросов, ни правил доступа.
 */
export function ConversationInfoDialog({
 state,
 title,
 channel,
 memberIds,
 avatar,
 channelLabel,
 dialog,
 onSaved,
 onClose,
 onProfile,
 onMaterials,
 onSettings
}: Props) {
 const model = useConversationInfo({chat: state, channel, memberIds, dialog, onSaved});
 const {editing, name, image, busy, error, crop, memberQuery, shown, remote, hint, actions} = model;
 const picker = useRef<HTMLInputElement>(null),
  camera = useRef<HTMLButtonElement>(null),
  editTrigger = useRef<HTMLButtonElement>(null),
  nameInput = useRef<HTMLInputElement>(null),
  close = useRef<HTMLButtonElement>(null);

 const restoreEdit = () => requestAnimationFrame(() => editTrigger.current?.focus());

 // Фокус — забота интерфейса, но момент перехода задаёт модель.
 useEffect(() => {
  if (editing) requestAnimationFrame(() => nameInput.current?.focus());
  else restoreEdit();
 }, [editing]);

 function begin() {
  actions.begin();
  requestAnimationFrame(() => nameInput.current?.focus());
 }
 function cancel() {
  actions.cancel();
  restoreEdit();
 }
 function closeCrop() {
  actions.setCrop(undefined);
  requestAnimationFrame(() => camera.current?.focus());
 }

 const previewName = editing ? name : title,
  previewAvatar = editing ? image : avatar;

 return (
  <DialogPrimitive.Root
   open
   onOpenChange={open => {
    if (!open && !busy && !crop) {
     if (editing) cancel();
     else onClose();
    }
   }}
  >
   <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="modal-backdrop conversation-info-backdrop" />
    <DialogPrimitive.Content
     className="conversation-info-dialog conversation-info-positioned fixed top-1/2 left-1/2 z-[1001] flex max-h-[calc(100dvh_-_40px)] w-[min(440px,calc(100vw_-_24px))] [transform:translate(-50%,-50%)] flex-col overflow-hidden"
     aria-describedby={undefined}
     onOpenAutoFocus={event => {
      event.preventDefault();
      close.current?.focus();
     }}
     onEscapeKeyDown={event => {
      if (busy || crop) event.preventDefault();
     }}
     onInteractOutside={event => {
      if (busy || crop || editing) event.preventDefault();
     }}
    >
     <header className="flex items-center justify-between border-b border-[#ffffff0c] px-4 py-3 text-sm leading-[1.5] font-semibold">
      <span>Информация о чате</span>
      <button
       ref={close}
       type="button"
       className="grid size-11 place-items-center rounded-[8px] border-0 bg-transparent hover:bg-[#ffffff08]"
       disabled={busy}
       aria-label="Закрыть информацию о чате"
       title="Закрыть"
       onClick={onClose}
      >
       <X size={20} />
      </button>
     </header>
     <div className="conversation-info-scroll overflow-auto px-5 pb-5">
      <div className="conversation-info-identity py-6 text-center">
       <span
        className="conversation-info-avatar mx-auto mb-3 grid size-20 place-items-center overflow-hidden rounded-[24px] bg-[#37373f] text-[28px] leading-[1.5] font-semibold"
        aria-hidden="true"
       >
        {previewAvatar ? (
         <img src={previewAvatar} alt="" className="size-full object-cover" />
        ) : (
         previewName
          .trim()
          .split(/\s+/)
          .slice(0, 2)
          .map(word => word[0])
          .join('')
          .toLocaleUpperCase('ru')
        )}
       </span>
       <DialogPrimitive.Title asChild>
        <h2 id="conversation-info-title" className="m-0 text-[22px] leading-[1.3] [overflow-wrap:anywhere]">
         {previewName || 'Название чата'}
        </h2>
       </DialogPrimitive.Title>
       <p className="mt-1.5 mb-0 text-sm leading-[1.5] text-[#adadb7]">{participantCount(memberIds.length)}</p>
       {channelLabel && (
        <p className="conversation-info-channel mt-3 text-xs leading-[1.5] text-[#adadb7]">
         Канал: {channelLabel} · материалы только этого канала
        </p>
       )}
       {model.editable && !editing && (
        <Button
         ref={editTrigger}
         variant="ghost"
         size="sm"
         type="button"
         className="mx-auto mt-3"
         data-edit-dialog
         onClick={begin}
        >
         <Pencil size={16} />
         Редактировать чат
        </Button>
       )}
      </div>
      {editing && model.editable && (
       <section
        className={cn('conversation-info-editor', 'rounded-[12px] border border-[#ffffff16] bg-[#ffffff04] p-4')}
        data-dialog-metadata-editor
        aria-label="Редактировать чат"
       >
        <div className="conversation-info-edit-avatar flex flex-wrap gap-2">
         <Button
          ref={camera}
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => picker.current?.click()}
         >
          <Camera size={16} />
          Изменить аватар
         </Button>
         {image && (
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => actions.setImage('')}>
           Удалить аватар
          </Button>
         )}
         <input
          ref={picker}
          hidden
          type="file"
          accept="image/png,image/jpeg,image/webp"
          aria-label="Аватар чата"
          onChange={event => {
           const file = event.target.files?.[0];
           event.target.value = '';
           if (file) actions.setCrop(file);
          }}
         />
        </div>
        <p className="conversation-info-edit-hint mt-3 mb-4 text-xs leading-[1.5] text-[#b9b9c3]">
         PNG, JPEG или WebP. Квадратный аватар до 256 КБ. Изменения увидят все участники после сохранения.
        </p>
        <label className="flex flex-col gap-2 text-sm leading-[1.5]" htmlFor="dialog-metadata-name">
         Название чата
         <input
          ref={nameInput}
          id="dialog-metadata-name"
          className="min-h-10 w-full rounded-[8px] border border-[#ffffff26] bg-[#161619] px-3 py-2 [color:inherit]"
          value={name}
          maxLength={60}
          disabled={busy}
          onChange={event => actions.setName(event.target.value)}
         />
        </label>
        {error && (
         <p role="alert" className="conversation-info-edit-error mt-3 text-[13px] leading-[1.5] text-[#ffb4ab]">
          {error} Черновик не потерян.
         </p>
        )}
        <div className="conversation-info-edit-actions mt-4 flex justify-end gap-2">
         <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={cancel}>
          Отмена
         </Button>
         <Button
          type="button"
          size="sm"
          disabled={busy || !model.canSave}
          onClick={() => void actions.save()}
          data-save-dialog
         >
          {busy ? 'Сохранение…' : 'Сохранить'}
         </Button>
        </div>
       </section>
      )}
      {onSettings && (
       <button
        className="conversation-info-settings flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-[8px] border-0 bg-transparent px-2 py-2.5 text-left text-sm leading-[1.5] text-inherit hover:bg-[#ffffff08] [&>svg]:shrink-0 [&>svg]:text-[#adadb7] [&>svg:last-child]:ml-auto"
        type="button"
        onClick={onSettings}
       >
        <Settings size={18} />
        Настройки группы
        <ChevronRight size={16} />
       </button>
      )}
      <ConversationMaterialRows messages={state.messages} channel={channel} onOpen={onMaterials} />
      <section className="conversation-info-members" aria-label="Участники чата">
       <h3 className="mt-4 mb-2 text-[13px] leading-[1.5] font-semibold text-[#b9b9c3]">
        Участники <span className="ml-1.5 text-[#aaaab4]">{memberIds.length}</span>
       </h3>
       <label
        className={cn(
         'conversation-info-member-search',
         'mt-3 flex flex-col gap-2 text-[13px] leading-[1.5] text-[#b9b9c3]'
        )}
       >
        Найти участника
        <input
         type="search"
         className="min-h-10 w-full rounded-[8px] border border-[#ffffff26] bg-[#161619] px-3 py-2 text-[#eeeef0]"
         aria-label="Поиск участников по имени, логину или email"
         placeholder="Имя, логин или полный email"
         value={memberQuery}
         maxLength={128}
         onChange={event => actions.setMemberQuery(event.target.value)}
        />
       </label>
       <p
        className="conversation-info-search-status my-2 min-h-[18px] text-xs leading-[1.5] text-[#b9b9c3]"
        role="status"
        aria-live="polite"
       >
        {hint}
       </p>
       {shown.map(id => {
        const user =
         id === state.me.id
          ? state.me
          : state.users.find(item => item.id === id) || remote?.users.find(item => item.id === id);
        return user ? (
         <button
          key={id}
          type="button"
          className="conversation-info-member flex min-h-16 w-full items-center gap-3 rounded-[8px] border-0 bg-transparent px-2 py-2 text-left hover:bg-[#ffffff08] [&>svg]:shrink-0 [&>svg]:text-[#aaaab4]"
          onClick={() => onProfile(id)}
         >
          <UserAvatar user={user} decorative decoration={user.decorations?.avatar} />
          <span className="flex min-w-0 flex-1 flex-col gap-1">
           <strong className="text-sm leading-[1.5] font-medium [overflow-wrap:anywhere]">
            {user.name}
            {id === state.me.id && (
             <small className="text-xs leading-[1.5] font-normal text-[#aaaab4]"> · это вы</small>
            )}
           </strong>
           <small
            className="text-xs leading-[1.5] font-normal text-[#aaaab4] data-[online]:text-[#7ac79c]"
            data-online={user.online || undefined}
           >
            {peerStatus(user)}
           </small>
          </span>
          <ChevronRight size={16} />
         </button>
        ) : (
         <div key={id} className="conversation-info-member is-unavailable [overflow-wrap:anywhere]">
          Участник недоступен
         </div>
        );
       })}
      </section>
     </div>
     {crop && (
      <ImageCropDialog
       file={crop}
       kind="avatar"
       onClose={closeCrop}
       onConfirm={result => {
        actions.setImage(result.dataUrl);
        closeCrop();
       }}
      />
     )}
    </DialogPrimitive.Content>
   </DialogPrimitive.Portal>
  </DialogPrimitive.Root>
 );
}

export type {User};
