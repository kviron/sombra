import type {RefObject} from 'react';
import {ConversationMaterialRows, type ProfileConversationMaterials} from '@/features/conversation-details';
import {Check, Clock3, MessageCircle, Sparkles, UserMinus, UserPlus, X} from 'lucide-react';
import type {Group, ProfileEffectTarget, User} from '@/shared/types';
import {UserAvatar} from '@/shared/ui/user-avatar';
import {ProfileCover} from '@/shared/ui/profile-cover';
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
    className="user-profile"
    data-avatar-fx-priority="profile"
    onMouseDown={event => event.stopPropagation()}
   >
    <button
     ref={model.closeButton}
     type="button"
     className="user-profile-close"
     title="Закрыть профиль"
     aria-label="Закрыть профиль"
     onClick={onClose}
    >
     <X size={18} />
    </button>
    <ProfileCover user={user} accountId={me.id} className="user-profile-banner" />
    <div className="user-profile-body">
     <div className="user-profile-identity">
      <UserAvatar user={user} size="xl" decorative decoration={user.decorations?.avatar} />
      <div className="user-profile-heading">
       <h2 id="user-profile-name">
        {user.name} {user.bot && <small className="bot-badge">БОТ</small>}
       </h2>
       {user.username && <p>@{user.username}</p>}
       <p className="user-profile-status" data-online={user.online ? 'true' : 'false'}>
        <span className="user-profile-status-dot" aria-hidden="true" />
        {statusText}
        {lastSeen ? <span className="user-profile-last">· {lastSeen}</span> : null}
        {isSelf && <span className="user-profile-self-tag">Это вы</span>}
       </p>
      </div>
     </div>

     <div className="user-profile-actions">
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
      <div className="user-profile-effect-action" key={effect.target}>
       <span>
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
      <p className="user-profile-effect-feedback" role={feedback.error ? 'alert' : 'status'}>
       {feedback.text}
      </p>
     )}

     {conversationMaterials && <ConversationMaterialRows {...conversationMaterials} />}
     {friendNote === 'friends' && (
      <span className="user-profile-friend">
       <Check size={13} /> В друзьях
      </span>
     )}
     {friendNote === 'outgoing' && (
      <span className="user-profile-friend is-muted">
       <Clock3 size={13} /> Заявка отправлена
      </span>
     )}
     {friendNote === 'incoming' && <span className="user-profile-friend is-waiting">Хочет добавить вас</span>}
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

     <p className={user.bio ? 'user-profile-bio' : 'user-profile-bio is-empty'}>
      {user.bio || 'Пользователь пока ничего не рассказал о себе.'}
     </p>

     <dl className="user-profile-facts">
      <div>
       <dt>В Sombra</dt>
       <dd>с {model.joinedText}</dd>
      </div>
      <div>
       <dt>Общие группы</dt>
       <dd>{shared.length ? shared.length : 'нет'}</dd>
      </div>
      <div>
       <dt>Последняя активность</dt>
       <dd>{model.activityText}</dd>
      </div>
     </dl>

     <section className="user-profile-groups" aria-label="Общие группы">
      <h3>
       Общие группы <span>{shared.length}</span>
      </h3>
      {shared.length ? (
       <ul>
        {shared.map(({group, memberLabel}) => (
         <li key={group.id}>
          <button
           type="button"
           disabled={!onOpenGroup}
           onClick={() => actions.openGroup(group.id)}
           title={onOpenGroup ? `Открыть «${group.name}»` : group.name}
          >
           <span className="user-profile-group-avatar" aria-hidden="true">
            {group.avatar ? <img src={group.avatar} alt="" /> : group.name.slice(0, 1).toLocaleUpperCase('ru')}
           </span>
           <span className="user-profile-group-text">
            <strong>{group.name}</strong>
            <small>{memberLabel}</small>
           </span>
          </button>
         </li>
        ))}
       </ul>
      ) : (
       <p className="user-profile-empty">Вы пока не состоите с этим человеком в общих группах.</p>
      )}
     </section>

     <section className="user-profile-note">
      <div className="user-profile-note-head">
       <h3>Заметка</h3>
       <span>{noteLabel}</span>
      </div>
      <textarea
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
