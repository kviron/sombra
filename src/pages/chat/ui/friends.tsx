import {TooltipLabel} from '@/shared/ui/tooltip';
import {Input} from '@/shared/ui/input';
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
  <section className="friends-page mx-auto min-h-0 w-full max-w-[1000px] overflow-auto px-5 py-3">
   <nav aria-label="Список друзей">
    {tabs.map(item => (
     <button key={item.id} aria-pressed={tab === item.id} onClick={() => actions.setTab(item.id)}>
      {item.id === 'add' && <UserPlus size={16} />}
      {item.label}
      {item.id === 'pending' && incoming > 0 && <small>{incoming}</small>}
     </button>
    ))}
   </nav>
   <Input
    className="mt-6"
    aria-label="Найти человека"
    placeholder="Поиск по имени"
    value={query}
    onChange={event => actions.setQuery(event.target.value)}
   />
   <p className="friends-count text-muted-foreground mt-6 mb-3 text-[11px]">
    {count} · {rows.length}
   </p>
   {rows.map(row => (
    <div className="friend-row flex items-center gap-[14px] border-b border-b-[#dce6fa12] py-4" key={row.user.id}>
     <UserAvatar user={row.user} size="md" presence={false} decoration={row.user.decorations?.avatar} />
     <div>
      <strong>{row.user.name}</strong>
      <small>{row.note}</small>
     </div>
     <div className="friend-actions ml-auto flex gap-[10px]">
      {row.kind === 'add' ? (
       <TooltipLabel content="Отправить заявку">
        <button disabled={busy} aria-label="Отправить заявку" onClick={() => actions.request(row.user.id)}>
         <UserPlus size={19} />
        </button>
       </TooltipLabel>
      ) : row.kind === 'friend' ? (
       <>
        <TooltipLabel content="Написать">
         <button disabled={busy} aria-label="Написать" onClick={() => actions.startDialog(row.user)}>
          <MessageCircle size={19} />
         </button>
        </TooltipLabel>
        <TooltipLabel content="Удалить из друзей">
         <button disabled={busy} aria-label="Удалить из друзей" onClick={() => actions.remove(row.friendId)}>
          <X size={16} />
         </button>
        </TooltipLabel>
       </>
      ) : (
       <>
        {row.accept && (
         <TooltipLabel content="Принять заявку">
          <button aria-label="Принять заявку" disabled={busy} onClick={() => actions.accept(row.friendId)}>
           <Check size={19} />
          </button>
         </TooltipLabel>
        )}
        <TooltipLabel content="Отклонить или отменить заявку">
         <button
          aria-label="Отклонить или отменить заявку"
          disabled={busy}
          onClick={() => actions.decline(row.friendId)}
         >
          <X size={19} />
         </button>
        </TooltipLabel>
       </>
      )}
     </div>
    </div>
   ))}
   {empty && (
    <div className="friends-empty text-muted-foreground flex min-h-[300px] flex-col items-center justify-center gap-4 text-center">
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
