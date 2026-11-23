import type {RefObject} from 'react';
import {ConversationMaterialRows, type ProfileConversationMaterials} from '@/features/conversation-details';
import {Check, Clock3, MessageCircle, Sparkles, UserMinus, UserPlus, X} from 'lucide-react';
import type {Group, ProfileEffectTarget, User} from '@/shared/types';
import {UserAvatar} from '@/shared/ui/user-avatar';
import {ProfileCover} from '@/shared/ui/profile-cover';
import {cn} from '@/shared/lib';
import {useUserProfile} from '../model/use-user-profile';
import './user-profile.css';

/**
 * Компонент только показывает: заметка, украшения, фокус в окне и вычисленные строки
 * приходят из модели страницы, поэтому здесь нет ни эффектов, ни localStorage.
 */
export function UserProfile({
 user,
 me,
 groups,
 onClose,
 onOpenGroup,
 conversationMaterials,
 restoreFocusRef,
 onApplyEffect
}: {
 user: User;
 me: User;
 groups: Group[];
 onClose: () => void;
 onOpenGroup?: (id: string) => void;
 conversationMaterials?: ProfileConversationMaterials;
 restoreFocusRef?: RefObject<HTMLButtonElement | null>;
 onApplyEffect?: (id: string, target: ProfileEffectTarget) => Promise<void>;
}) {
 const model = useUserProfile({user, me, groups, onClose, onOpenGroup, onApplyEffect, restoreFocusRef});
 const {
  isSelf,
  status,
  statusText,
  lastSeen,
  friendNote,
  shared,
  effects,
  note,
  noteLabel,
  applying,
  feedback,
  actions
 } = model;

 return (
  <div
   className="modal-backdrop"
   onMouseDown={event => {
    if (event.target === event.currentTarget) {
     event.preventDefault();
     onClose();
    }
   }}
  >
   <section
    role="dialog"
    aria-modal="true"
    aria-labelledby="user-profile-name"
    className={cn(
     'user-profile',
     'relative max-h-[calc(100vh_-_var(--title-bar-height,32px)_-_80px)] w-[min(760px,100%)] overflow-auto',
     'rounded-[18px] border border-[#e6eeff2b] text-[#d6dbe6]'
    )}
    data-avatar-fx-priority="profile"
    onMouseDown={event => event.stopPropagation()}
   >
    <button
     ref={model.closeButton}
     type="button"
     className="user-profile-close absolute top-3 right-3 z-[2] grid size-8 place-items-center rounded-[50%] border border-[#ffffff24] bg-[#090b12a8] text-[#d3d9e6] backdrop-blur-[10px]"
     title="Закрыть профиль"
     aria-label="Закрыть профиль"
     onClick={onClose}
    >
     <X size={18} />
    </button>
    <ProfileCover user={user} accountId={me.id} className="user-profile-banner border-b border-[#ffffff12]" />
    <div className="user-profile-body px-[26px] pb-[26px]">
     <div className="user-profile-identity relative z-[1] flex items-start gap-4">
      <UserAvatar user={user} size="xl" decorative decoration={user.decorations?.avatar} />
      <div className="user-profile-heading min-w-0 pt-4 pb-1">
       <h2
        id="user-profile-name"
        className="mt-0 mb-1.5 text-[24px] leading-[1.15] [font-weight:650] tracking-[-0.015em] [overflow-wrap:anywhere] text-[#f6f7fb]"
       >
        {user.name} {user.bot && <small className="bot-badge">БОТ</small>}
       </h2>
       {user.username && <p>@{user.username}</p>}
       <p
        className="user-profile-status m-0 flex flex-wrap items-center gap-[7px] text-[13px] leading-[1.4] text-[#9aa3b4]"
        data-online={user.online ? 'true' : 'false'}
       >
        <span className="user-profile-status-dot size-2 rounded-[50%] bg-[#626a79]" aria-hidden="true" />
        {statusText}
        {lastSeen ? <span className="user-profile-last text-[#808a9d]">· {lastSeen}</span> : null}
        {isSelf && (
         <span className="user-profile-self-tag rounded-[999px] border border-[#8c92ff40] bg-[#8c92ff1f] px-2 py-0.5 text-[11px] font-semibold text-[#b9bfff]">
          Это вы
         </span>
        )}
       </p>
      </div>
     </div>

     <div className="user-profile-actions mt-5 flex flex-wrap gap-2.5">
      {isSelf ? (
       <button type="button" className="user-profile-primary" onClick={actions.editOwnProfile}>
        Редактировать профиль
       </button>
      ) : (
       <>
        <button type="button" className="user-profile-primary" onClick={actions.message}>
         <MessageCircle size={16} /> Сообщение
        </button>
        {!user.bot && status === 'none' && (
         <button type="button" className="user-profile-secondary" onClick={actions.addFriend}>
          <UserPlus size={16} /> Добавить в друзья
         </button>
        )}
        {!user.bot && status === 'incoming' && (
         <button type="button" className="user-profile-secondary is-accept" onClick={actions.acceptFriend}>
          <Check size={16} /> Принять заявку
         </button>
        )}
        {!user.bot && status === 'outgoing' && (
         <button type="button" className="user-profile-secondary" disabled>
          <Clock3 size={16} /> Заявка отправлена
         </button>
        )}
        {!user.bot && status === 'friends' && (
         <button type="button" className="user-profile-secondary" onClick={actions.removeFriend}>
          <UserMinus size={16} /> Удалить из друзей
         </button>
        )}
       </>
      )}
     </div>

     {effects.map(effect => (
      <div
       className="user-profile-effect-action mt-2 flex flex-wrap items-center justify-between gap-2"
       key={effect.target}
      >
       <span className="flex items-center gap-2 text-[14px]">
        <Sparkles size={16} aria-hidden="true" /> {effect.label}
       </span>
       <button
        type="button"
        className="user-profile-secondary"
        disabled={applying || effect.applied}
        aria-label={`Поставить себе: ${effect.label.toLowerCase()}`}
        onClick={() => actions.applyEffect(effect.id, effect.target)}
       >
        {effect.applied ? 'Установлен' : 'Поставить себе'}
       </button>
      </div>
     ))}
     {feedback && (
      <p
       className="user-profile-effect-feedback mt-2 mb-0 text-[14px] [overflow-wrap:anywhere]"
       role={feedback.error ? 'alert' : 'status'}
      >
       {feedback.text}
      </p>
     )}

     {conversationMaterials && <ConversationMaterialRows {...conversationMaterials} />}
     {friendNote === 'friends' && (
      <span className="user-profile-friend mt-2.5 inline-flex items-center gap-1.5 text-[12px] text-[#93e0bd]">
       <Check size={13} /> В друзьях
      </span>
     )}
     {friendNote === 'outgoing' && (
      <span className="user-profile-friend is-muted mt-2.5 inline-flex items-center gap-1.5 text-[12px]">
       <Clock3 size={13} /> Заявка отправлена
      </span>
     )}
     {friendNote === 'incoming' && (
      <span className="user-profile-friend is-waiting mt-2.5 inline-flex items-center gap-1.5 text-[12px]">
       Хочет добавить вас
      </span>
     )}
     {user.bot && (
      <section aria-label="Команды бота">
       <h3>Команды</h3>
       {user.commands?.length ? (
        user.commands.map(command => (
         <p key={command.command}>
          <code>/{command.command.replace(/^\//, '')}</code> — {command.description}
         </p>
        ))
       ) : (
        <p>Введите /help в личном сообщении боту.</p>
       )}
       <p>Бот работает через отдельный сервис. Не отправляйте ему пароли и ключи.</p>
      </section>
     )}

     <p
      className={cn(
       'user-profile-bio mt-[18px] mb-0 max-w-[62ch] text-[14px] leading-[1.6] [overflow-wrap:anywhere] whitespace-pre-wrap text-[#cfd5e1]',
       !user.bio && 'is-empty'
      )}
     >
      {user.bio || 'Пользователь пока ничего не рассказал о себе.'}
     </p>

     <dl className="user-profile-facts mt-5 mb-0 grid grid-cols-3 gap-3 rounded-[12px] border border-[#ffffff12] bg-[#0a0c12a6] px-4 py-3.5">
      <div className="min-w-0">
       <dt className="text-[10px] font-semibold tracking-[0.08em] text-[#8b93a6] uppercase">В Sombra</dt>
       <dd className="mt-[5px] mb-0 text-[13px] leading-[1.35] [overflow-wrap:anywhere] text-[#e3e7ef]">
        с {model.joinedText}
       </dd>
      </div>
      <div className="min-w-0">
       <dt className="text-[10px] font-semibold tracking-[0.08em] text-[#8b93a6] uppercase">Общие группы</dt>
       <dd className="mt-[5px] mb-0 text-[13px] leading-[1.35] [overflow-wrap:anywhere] text-[#e3e7ef]">
        {shared.length ? shared.length : 'нет'}
       </dd>
      </div>
      <div className="min-w-0">
       <dt className="text-[10px] font-semibold tracking-[0.08em] text-[#8b93a6] uppercase">Последняя активность</dt>
       <dd className="mt-[5px] mb-0 text-[13px] leading-[1.35] [overflow-wrap:anywhere] text-[#e3e7ef]">
        {model.activityText}
       </dd>
      </div>
     </dl>

     <section className="user-profile-groups mt-[22px]" aria-label="Общие группы">
      <h3 className="m-0 text-[11px] font-semibold tracking-[0.08em] text-[#949cad] uppercase">
       Общие группы{' '}
       <span className="ml-1 rounded-[999px] bg-[#ffffff12] px-1.5 py-px text-[10px] tracking-normal text-[#b9c0ce]">
        {shared.length}
       </span>
      </h3>
      {shared.length ? (
       <ul className="mt-2 mb-0 flex list-none flex-col gap-0.5 p-0">
        {shared.map(({group, memberLabel}) => (
         <li key={group.id}>
          <button
           type="button"
           disabled={!onOpenGroup}
           onClick={() => actions.openGroup(group.id)}
           title={onOpenGroup ? `Открыть «${group.name}»` : group.name}
          >
           <span
            className="user-profile-group-avatar grid size-8 flex-[0_0_32px] place-items-center overflow-hidden rounded-[10px] bg-[#2b3450] text-[14px] font-semibold text-[#e7ecf8]"
            aria-hidden="true"
           >
            {group.avatar ? (
             <img className="size-full object-cover" src={group.avatar} alt="" />
            ) : (
             group.name.slice(0, 1).toLocaleUpperCase('ru')
            )}
           </span>
           <span className="user-profile-group-text flex min-w-0 flex-col">
            <strong className="overflow-hidden text-[13px] font-semibold text-ellipsis whitespace-nowrap text-[#e9edf5]">
             {group.name}
            </strong>
            <small className="mt-0.5 text-[11px] text-[#8f97a8]">{memberLabel}</small>
           </span>
          </button>
         </li>
        ))}
       </ul>
      ) : (
       <p className="user-profile-empty mt-2.5 mb-0 text-[12px] leading-[1.55] text-[#818a9c]">
        Вы пока не состоите с этим человеком в общих группах.
       </p>
      )}
     </section>

     <section className="user-profile-note mt-[22px] rounded-[12px] border border-[#ffffff12] bg-[#0a0c12a6] px-4 pt-3.5 pb-4">
      <div className="user-profile-note-head flex items-baseline justify-between gap-3">
       <h3 className="m-0 text-[11px] font-semibold tracking-[0.08em] text-[#949cad] uppercase">Заметка</h3>
       <span className="text-[11px] text-[#7d8598]">{noteLabel}</span>
      </div>
      <textarea
       className="mt-2.5 min-h-[74px] w-full resize-y rounded-[9px] border border-[#ffffff14] bg-[#070910] px-3 py-2.5 text-[13px] leading-[1.55] text-[#dde2ec] outline-none"
       aria-label={`Заметка о ${user.name}`}
       maxLength={280}
       rows={3}
       placeholder="Например: часовой пояс, чем занимается, о чём поговорить"
       value={note}
       onChange={event => actions.setNote(event.target.value)}
      />
     </section>
    </div>
   </section>
  </div>
 );
}
