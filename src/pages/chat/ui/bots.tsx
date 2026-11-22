import {Bot as BotIcon, Copy} from 'lucide-react';
import {type ChatState} from '@/shared/types';
import {UserAvatar} from '@/shared/ui/user-avatar';
import {BotSettingsDialog} from '@/features/bots';
import {BotToolAccess} from '@/features/bots';
import {useChatBots} from '../model/use-chat-bots';
import '@/features/bots/ui/bots.css';

/** Окно «Подключения»: разметка без логики — строки, права и действия приходят из модели. */
export function Bots({
 state,
 refresh,
 onError,
 channel,
 group,
 owner
}: {state: ChatState; refresh: () => Promise<unknown>; onError: (message: string) => void} & {
 channel: string;
 group?: string;
 owner: boolean;
}) {
 const {rows, managed, name, username, token, busy, copied, createDisabled, actions} = useChatBots({
  state,
  refresh,
  onError,
  channel,
  group,
  owner
 });
 return (
  <section className="bot-settings">
   <BotIcon size={28} />
   <h3>{group ? 'Боты в этой группе' : 'Боты в этой комнате'}</h3>
   <p>
    Бот — отдельный участник. По умолчанию получает команды и упоминания в группе, сообщения в личном диалоге. ИИ
    работает через отдельный сервис; доступ к инструментам автоматически не предоставляется.
   </p>
   {rows.map(row => (
    <article className="bot-installation" key={row.bot.id}>
     <div className="bot-installation-heading">
      <UserAvatar user={row.user} size="sm" presence={false} />
      <div>
       <strong>{row.bot.name}</strong> <small className="bot-badge">БОТ</small>
       {row.bot.username && <p>@{row.bot.username}</p>}
      </div>
     </div>
     <p>{row.status}</p>
     <p>{row.privacy}</p>
     {row.commands.length ? (
      <ul>
       {row.commands.map(command => (
        <li key={command.command}>
         <code>/{command.command.replace(/^\//, '')}</code> — {command.description}
        </li>
       ))}
      </ul>
     ) : (
      <p>Команды: /help</p>
     )}
     <div className="bot-installation-actions">
      {row.settings && (
       <button type="button" onClick={() => actions.openManagement(row.bot.id)}>
        Настроить бота
       </button>
      )}
      {row.token && (
       <button type="button" disabled={busy} onClick={() => actions.rotate(row.bot)}>
        Заменить ключ
       </button>
      )}
      {row.remove && (
       <button type="button" disabled={busy} onClick={() => actions.remove(row.bot)}>
        Отключить
       </button>
      )}
     </div>
     {row.settings && <BotToolAccess bot={row.bot} state={state} rootBusy={busy} />}
    </article>
   ))}
   {managed && <BotSettingsDialog bot={managed} state={state} refresh={refresh} onClose={actions.closeManagement} />}
   {!rows.length && <p>Здесь пока нет подключённых ботов.</p>}
   {owner && (
    <>
     <label>
      Имя бота
      <input
       aria-label="Имя бота"
       maxLength={32}
       value={name}
       onChange={event => actions.setName(event.target.value)}
       placeholder="Помощник команды"
      />
     </label>
     {group && (
      <label>
       Уникальное имя
       <input
        aria-label="Уникальное имя бота"
        maxLength={32}
        value={username}
        onChange={event => actions.setUsername(event.target.value)}
        placeholder="team_bot"
        autoCapitalize="none"
        autoCorrect="off"
       />
      </label>
     )}
     <button type="button" className="small-button" disabled={createDisabled} onClick={actions.create}>
      Создать бота
     </button>
    </>
   )}
   {token && (
    <div className="bot-token">
     <p>Новый ключ показан только сейчас. Сохраните его на машине сервиса бота. Не отправляйте в чат.</p>
     <input type="password" aria-label="Новый ключ бота" readOnly value={token} autoComplete="off" />
     <button type="button" className="small-button" onClick={actions.copyToken}>
      <Copy size={16} />
      {copied ? 'Скопировано' : 'Скопировать ключ'}
     </button>
     <button type="button" onClick={actions.dismissToken}>
      Я сохранил ключ
     </button>
    </div>
   )}
  </section>
 );
}
