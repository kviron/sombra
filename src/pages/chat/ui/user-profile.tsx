import { useEffect, useRef, useState, type RefObject } from 'react';
import {ConversationMaterialRows,type ProfileConversationMaterials} from '@/features/conversation-details';
import { Check, Clock3, MessageCircle, Sparkles, UserMinus, UserPlus, X } from 'lucide-react';
import type { Group, ProfileEffectTarget, User } from '@/shared/types';
import { UserAvatar } from '@/shared/ui/user-avatar';
import { ProfileCover } from '@/shared/ui/profile-cover';
import { useUserActions } from '@/shared/lib/user-actions';
import './user-profile.css';

function formatDay(timestamp: number) {
  return new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long', year: 'numeric' }).format(timestamp * 1000);
}

function formatMoment(timestamp: number) {
  const date = new Date(timestamp * 1000);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? `сегодня в ${date.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}`
    : `${date.toLocaleDateString('ru', { day: 'numeric', month: 'short' })} в ${date.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}`;
}

export function UserProfile({
  user,
  me,
  groups,
  onClose,
  onOpenGroup,
  conversationMaterials,
  restoreFocusRef,
  onApplyEffect,
}: {
  user: User;
  me: User;
  groups: Group[];
  onClose: () => void;
  onOpenGroup?: (id: string) => void;
  conversationMaterials?: ProfileConversationMaterials;
  restoreFocusRef?: RefObject<HTMLButtonElement|null>;
  onApplyEffect?: (id: string, target: ProfileEffectTarget) => Promise<void>;
}) {
  const actions = useUserActions();
  const isSelf = user.id === me.id;
  const [effectFeedback,setEffectFeedback] = useState<{text:string;error?:boolean}>();
  const [applyingEffect,setApplyingEffect] = useState(false);
  const applyingLock = useRef(false);
  async function applyEffect(id: string,target: ProfileEffectTarget) {
    if (!onApplyEffect || applyingLock.current) return;
    applyingLock.current=true;setApplyingEffect(true);setEffectFeedback(undefined);
    try { await onApplyEffect(id,target);setEffectFeedback({text:target==='avatar'?'Рамка применена':'Эффект обложки применён'}); }
    catch (reason) {setEffectFeedback({text:reason instanceof Error?reason.message:'Не удалось применить эффект',error:true});}
    finally {applyingLock.current=false;setApplyingEffect(false);}
  }
  const status = isSelf ? 'self' : actions?.friendStatus(user.id) ?? 'none';
  const shared = groups.filter((group) => group.members.includes(user.id));
  const noteKey = `sombra-profile-note:${me.id}:${user.id}`;
  const [note, setNote] = useState(() => {
    try { return localStorage.getItem(noteKey) ?? ''; } catch { return ''; }
  });
  const [saved, setSaved] = useState(false);
  const closeButton = useRef<HTMLButtonElement>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const restoreRef = useRef(restoreFocusRef); restoreRef.current = restoreFocusRef;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRef.current(); }
      if (event.key === 'Tab') {
        const dialog = closeButton.current?.closest('[role="dialog"]');
        const items = Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input,textarea') ?? []).filter(item => item.getClientRects().length);
        const first = items[0], last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      const target = restoreRef.current?.current ?? previous;
      if (target?.isConnected) target.focus();
    };
  }, []);

  function updateNote(value: string) {
    setNote(value);
    try { localStorage.setItem(noteKey, value); setSaved(true); } catch { /* local note is optional */ }
  }

  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => setSaved(false), 1800);
    return () => window.clearTimeout(timer);
  }, [saved]);

  const statusText = user.online ? 'В сети' : 'Не в сети';
  const friendNote = (() => {
    if (isSelf || user.bot) return null;
    if (status === 'friends') return <span className="user-profile-friend"><Check size={13} /> В друзьях</span>;
    if (status === 'outgoing') return <span className="user-profile-friend is-muted"><Clock3 size={13} /> Заявка отправлена</span>;
    if (status === 'incoming') return <span className="user-profile-friend is-waiting">Хочет добавить вас</span>;
    return null;
  })();

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) { event.preventDefault(); onClose(); } }}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-profile-name"
        className="user-profile"
        data-avatar-fx-priority="profile"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button ref={closeButton} type="button" className="user-profile-close" title="Закрыть профиль" aria-label="Закрыть профиль" onClick={onClose}>
          <X size={18} />
        </button>
        <ProfileCover user={user} accountId={me.id} className="user-profile-banner" />
        <div className="user-profile-body">
          <div className="user-profile-identity">
            <UserAvatar user={user} size="xl" decorative decoration={user.decorations?.avatar} />
            <div className="user-profile-heading">
              <h2 id="user-profile-name">{user.name} {user.bot && <small className="bot-badge">БОТ</small>}</h2>
              {user.username && <p>@{user.username}</p>}
              <p className="user-profile-status" data-online={user.online ? 'true' : 'false'}>
                <span className="user-profile-status-dot" aria-hidden="true" />
                {statusText}
                {!user.online && user.last_seen ? <span className="user-profile-last">· {formatMoment(user.last_seen)}</span> : null}
                {isSelf && <span className="user-profile-self-tag">Это вы</span>}
              </p>
            </div>
          </div>

          <div className="user-profile-actions">
            {isSelf ? (
              <button type="button" className="user-profile-primary" onClick={() => { onClose(); actions?.editOwnProfile(); }}>
                Редактировать профиль
              </button>
            ) : (
              <>
                <button type="button" className="user-profile-primary" onClick={() => { actions?.messageUser(user.id); onClose(); }}>
                  <MessageCircle size={16} /> Сообщение
                </button>
                {!user.bot && status === 'none' && (
                  <button type="button" className="user-profile-secondary" onClick={() => actions?.addFriend(user.id)}>
                    <UserPlus size={16} /> Добавить в друзья
                  </button>
                )}
                {!user.bot && status === 'incoming' && (
                  <button type="button" className="user-profile-secondary is-accept" onClick={() => actions?.acceptFriend(user.id)}>
                    <Check size={16} /> Принять заявку
                  </button>
                )}
                {!user.bot && status === 'outgoing' && (
                  <button type="button" className="user-profile-secondary" disabled>
                    <Clock3 size={16} /> Заявка отправлена
                  </button>
                )}
                {!user.bot && status === 'friends' && (
                  <button type="button" className="user-profile-secondary" onClick={() => actions?.removeFriend(user.id)}>
                    <UserMinus size={16} /> Удалить из друзей
                  </button>
                )}
              </>
            )}
          </div>

          {!isSelf && !me.bot && onApplyEffect && (['avatar','cover'] as const).map(target=>{
            // For another user the server projects only currently public references.
            const id=user.decorationRefs?.[target];
            if(!id || !user.decorations?.[target])return null;
            const applied=me.decorationRefs?.[target]===id;
            const label=target==='avatar'?'Рамка аватара':'Эффект обложки';
            return <div className="user-profile-effect-action" key={target}>
              <span><Sparkles size={16} aria-hidden="true" /> {label}</span>
              <button type="button" className="user-profile-secondary" disabled={applyingEffect||applied} aria-label={`Поставить себе: ${label.toLowerCase()}`} onClick={()=>void applyEffect(id,target)}>{applied?'Установлен':'Поставить себе'}</button>
            </div>;
          })}
          {effectFeedback&&<p className="user-profile-effect-feedback" role={effectFeedback.error?'alert':'status'}>{effectFeedback.text}</p>}

          {conversationMaterials && <ConversationMaterialRows {...conversationMaterials} />}
          {friendNote}
          {user.bot && <section aria-label="Команды бота"><h3>Команды</h3>{user.commands?.length ? user.commands.map(command => <p key={command.command}><code>/{command.command.replace(/^\//, '')}</code> — {command.description}</p>) : <p>Введите /help в личном сообщении боту.</p>}<p>Бот работает через отдельный сервис. Не отправляйте ему пароли и ключи.</p></section>}

          <p className={user.bio ? 'user-profile-bio' : 'user-profile-bio is-empty'}>
            {user.bio || 'Пользователь пока ничего не рассказал о себе.'}
          </p>

          <dl className="user-profile-facts">
            <div>
              <dt>В Sombra</dt>
              <dd>с {formatDay(user.created_at)}</dd>
            </div>
            <div>
              <dt>Общие группы</dt>
              <dd>{shared.length ? shared.length : 'нет'}</dd>
            </div>
            <div>
              <dt>Последняя активность</dt>
              <dd>{user.online ? 'сейчас' : user.last_seen ? formatMoment(user.last_seen) : 'неизвестно'}</dd>
            </div>
          </dl>

          <section className="user-profile-groups" aria-label="Общие группы">
            <h3>Общие группы <span>{shared.length}</span></h3>
            {shared.length ? (
              <ul>
                {shared.map((group) => (
                  <li key={group.id}>
                    <button type="button" disabled={!onOpenGroup} onClick={() => { onOpenGroup?.(group.id); onClose(); }} title={onOpenGroup ? `Открыть «${group.name}»` : group.name}>
                      <span className="user-profile-group-avatar" aria-hidden="true">
                        {group.avatar ? <img src={group.avatar} alt="" /> : group.name.slice(0, 1).toLocaleUpperCase('ru')}
                      </span>
                      <span className="user-profile-group-text">
                        <strong>{group.name}</strong>
                        <small>{group.members.length} {group.members.length === 1 ? 'участник' : group.members.length < 5 ? 'участника' : 'участников'}</small>
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
              <span>{saved ? 'Сохранено' : 'Видна только вам'}</span>
            </div>
            <textarea
              aria-label={`Заметка о ${user.name}`}
              maxLength={280}
              rows={3}
              placeholder="Например: часовой пояс, чем занимается, о чём поговорить"
              value={note}
              onChange={(event) => updateNote(event.target.value)}
            />
          </section>
        </div>
      </section>
    </div>
  );
}
