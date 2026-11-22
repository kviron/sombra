import {Check, MessageCircle, UserPlus, X} from 'lucide-react';
import {type ChatState} from '@/shared/types';
import {UserAvatar} from '@/shared/ui/user-avatar';
import {useChatFriends} from '../model/use-chat-friends';

/** Друзья: разметка без логики — вкладка, поиск и действия приходят из модели. */
export function Friends({
 state,
 refresh,
 onError,
 onDialog
}: {state: ChatState; refresh: () => Promise<unknown>; onError: (message: string) => void} & {
 onDialog: (id: string) => void;
}) {
 const {tabs, tab, query, busy, count, incoming, empty, rows, actions} = useChatFriends({
  state,
  refresh,
  onError,
  onDialog
 });
 return (
  <section className="friends-page">
   <nav aria-label="Список друзей">
    {tabs.map(item => (
     <button key={item.id} aria-pressed={tab === item.id} onClick={() => actions.setTab(item.id)}>
      {item.id === 'add' && <UserPlus size={16} />}
      {item.label}
      {item.id === 'pending' && incoming > 0 && <small>{incoming}</small>}
     </button>
    ))}
   </nav>
   <input
    className="friend-search"
    aria-label="Найти человека"
    placeholder="Поиск по имени"
    value={query}
    onChange={event => actions.setQuery(event.target.value)}
   />
   <p className="friends-count">
    {count} · {rows.length}
   </p>
   {rows.map(row => (
    <div className="friend-row" key={row.user.id}>
     <UserAvatar user={row.user} size="md" presence={false} decoration={row.user.decorations?.avatar} />
     <div>
      <strong>{row.user.name}</strong>
      <small>{row.note}</small>
     </div>
     <div className="friend-actions">
      {row.kind === 'add' ? (
       <button disabled={busy} title="Отправить заявку" onClick={() => actions.request(row.user.id)}>
        <UserPlus size={19} />
       </button>
      ) : row.kind === 'friend' ? (
       <>
        <button disabled={busy} title="Написать" onClick={() => actions.startDialog(row.user)}>
         <MessageCircle size={19} />
        </button>
        <button disabled={busy} title="Удалить из друзей" onClick={() => actions.remove(row.friendId)}>
         <X size={16} />
        </button>
       </>
      ) : (
       <>
        {row.accept && (
         <button title="Принять заявку" disabled={busy} onClick={() => actions.accept(row.friendId)}>
          <Check size={19} />
         </button>
        )}
        <button title="Отклонить или отменить заявку" disabled={busy} onClick={() => actions.decline(row.friendId)}>
         <X size={19} />
        </button>
       </>
      )}
     </div>
    </div>
   ))}
   {empty && (
    <div className="friends-empty">
     <UserPlus size={36} />
     <h2>{empty.title}</h2>
     <p>{empty.note}</p>
     {empty.add && (
      <button className="small-button" onClick={() => actions.setTab('add')}>
       Добавить друга
      </button>
     )}
    </div>
   )}
  </section>
 );
}
