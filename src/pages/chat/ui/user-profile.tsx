import type {RefObject} from 'react';
import {ConversationMaterialRows, type ProfileConversationMaterials} from '@/features/conversation-details';
import {Check, Clock3, MessageCircle, Sparkles, UserMinus, UserPlus, X} from 'lucide-react';
import type {Group, ProfileEffectTarget, User} from '@/shared/types';
import {UserAvatar} from '@/shared/ui/user-avatar';
import {Button} from '@/shared/ui/button';
import {Textarea} from '@/shared/ui/textarea';
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
     'border-border bg-background text-foreground rounded-[18px] border'
    )}
    data-avatar-fx-priority="profile"
    onMouseDown={event => event.stopPropagation()}
   >
    <Button
     ref={model.closeButton}
     type="button"
     variant="secondary"
     size="icon"
     className="absolute top-3 right-3 z-[2]"
     title="Закрыть профиль"
     aria-label="Закрыть профиль"
     onClick={onClose}
    >
     <X size={18} />
    </Button>
    <ProfileCover user={user} accountId={me.id} className="user-profile-banner border-border border-b" />
    <div className="user-profile-body px-[26px] pb-[26px]">
     <div className="user-profile-identity relative z-[1] flex items-start gap-4">
      <UserAvatar user={user} size="xl" decorative decoration={user.decorations?.avatar} />
      <div className="user-profile-heading min-w-0 pt-4 pb-1">
       <h2
        id="user-profile-name"
        className="text-foreground mt-0 mb-1.5 text-[24px] leading-[1.15] [font-weight:650] tracking-[-0.015em] [overflow-wrap:anywhere]"
       >
        {user.name}{' '}
        {user.bot && <small className="bot-badge text-primary rounded-[4px] px-[5px] py-px text-[9px]">БОТ</small>}
       </h2>
       {user.username && <p>@{user.username}</p>}
       <p
        className="user-profile-status text-muted-foreground m-0 flex flex-wrap items-center gap-[7px] text-[13px] leading-[1.4]"
        data-online={user.online ? 'true' : 'false'}
       >
        <span className="user-profile-status-dot bg-muted size-2 rounded-[50%]" aria-hidden="true" />
        {statusText}
        {lastSeen ? <span className="user-profile-last text-muted-foreground">· {lastSeen}</span> : null}
        {isSelf && (
         <span className="user-profile-self-tag border-border text-primary rounded-[999px] border px-2 py-0.5 text-[11px] font-semibold">
          Это вы
         </span>
        )}
       </p>
      </div>
     </div>

     <div className="user-profile-actions mt-5 flex flex-wrap gap-2.5">
      {isSelf ? (
       <Button type="button" onClick={actions.editOwnProfile}>
        Редактировать профиль
       </Button>
      ) : (
       <>
        <Button type="button" onClick={actions.message}>
         <MessageCircle size={16} /> Сообщение
        </Button>
        {!user.bot && status === 'none' && (
         <Button type="button" variant="outline" onClick={actions.addFriend}>
          <UserPlus size={16} /> Добавить в друзья
         </Button>
        )}
        {!user.bot && status === 'incoming' && (
         <Button type="button" variant="outline" onClick={actions.acceptFriend}>
          <Check size={16} /> Принять заявку
         </Button>
        )}
        {!user.bot && status === 'outgoing' && (
         <Button type="button" variant="outline" disabled>
          <Clock3 size={16} /> Заявка отправлена
         </Button>
        )}
        {!user.bot && status === 'friends' && (
         <Button type="button" variant="outline" onClick={actions.removeFriend}>
          <UserMinus size={16} /> Удалить из друзей
         </Button>
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
       <Button
        type="button"
        variant="outline"
        disabled={applying || effect.applied}
        aria-label={`Поставить себе: ${effect.label.toLowerCase()}`}
        onClick={() => actions.applyEffect(effect.id, effect.target)}
       >
        {effect.applied ? 'Установлен' : 'Поставить себе'}
       </Button>
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
      <span className="user-profile-friend mt-2.5 inline-flex items-center gap-1.5 text-[12px] text-emerald-500">
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
       'user-profile-bio text-muted-foreground mt-[18px] mb-0 max-w-[62ch] text-[14px] leading-[1.6] [overflow-wrap:anywhere] whitespace-pre-wrap',
       !user.bio && 'is-empty'
      )}
     >
      {user.bio || 'Пользователь пока ничего не рассказал о себе.'}
     </p>

     <dl className="user-profile-facts border-border bg-card mt-5 mb-0 grid grid-cols-3 gap-3 rounded-[12px] border px-4 py-3.5">
      <div className="min-w-0">
       <dt className="text-muted-foreground text-[10px] font-semibold tracking-[0.08em] uppercase">В Sombra</dt>
       <dd className="text-foreground mt-[5px] mb-0 text-[13px] leading-[1.35] [overflow-wrap:anywhere]">
        с {model.joinedText}
       </dd>
      </div>
      <div className="min-w-0">
       <dt className="text-muted-foreground text-[10px] font-semibold tracking-[0.08em] uppercase">Общие группы</dt>
       <dd className="text-foreground mt-[5px] mb-0 text-[13px] leading-[1.35] [overflow-wrap:anywhere]">
        {shared.length ? shared.length : 'нет'}
       </dd>
      </div>
      <div className="min-w-0">
       <dt className="text-muted-foreground text-[10px] font-semibold tracking-[0.08em] uppercase">
        Последняя активность
       </dt>
       <dd className="text-foreground mt-[5px] mb-0 text-[13px] leading-[1.35] [overflow-wrap:anywhere]">
        {model.activityText}
       </dd>
      </div>
     </dl>

     <section className="user-profile-groups mt-[22px]" aria-label="Общие группы">
      <h3 className="text-muted-foreground m-0 text-[11px] font-semibold tracking-[0.08em] uppercase">
       Общие группы{' '}
       <span className="text-muted-foreground ml-1 rounded-[999px] px-1.5 py-px text-[10px] tracking-normal">
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
            className="user-profile-group-avatar bg-card text-foreground grid size-8 flex-[0_0_32px] place-items-center overflow-hidden rounded-[10px] text-[14px] font-semibold"
            aria-hidden="true"
           >
            {group.avatar ? (
             <img className="size-full object-cover" src={group.avatar} alt="" />
            ) : (
             group.name.slice(0, 1).toLocaleUpperCase('ru')
            )}
           </span>
           <span className="user-profile-group-text flex min-w-0 flex-col">
            <strong className="text-foreground overflow-hidden text-[13px] font-semibold text-ellipsis whitespace-nowrap">
             {group.name}
            </strong>
            <small className="text-muted-foreground mt-0.5 text-[11px]">{memberLabel}</small>
           </span>
          </button>
         </li>
        ))}
       </ul>
      ) : (
       <p className="user-profile-empty text-muted-foreground mt-2.5 mb-0 text-[12px] leading-[1.55]">
        Вы пока не состоите с этим человеком в общих группах.
       </p>
      )}
     </section>

     <section className="user-profile-note border-border bg-card mt-[22px] rounded-[12px] border px-4 pt-3.5 pb-4">
      <div className="user-profile-note-head flex items-baseline justify-between gap-3">
       <h3 className="text-muted-foreground m-0 text-[11px] font-semibold tracking-[0.08em] uppercase">Заметка</h3>
       <span className="text-muted-foreground text-[11px]">{noteLabel}</span>
      </div>
      <Textarea
       className="mt-2.5 resize-y"
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
