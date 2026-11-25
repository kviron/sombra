import {useId} from 'react';
import {type Bot, type ChatState} from '@/shared/types';
import {Button} from '@/shared/ui/button';
import {Checkbox} from '@/shared/ui/checkbox';
import {Input} from '@/shared/ui/input';
import {useBotToolAccess, useBotToolPolicy} from '../model/use-bot-tool-access';
import {toolAccessFull, toolUpgradeNote} from '../model/bot-tool-access-rules';
import './bot-tool-access.css';

/** Private policy exists only in this mounted, explicitly expanded owner panel. */
export function BotToolAccess({bot, state, rootBusy}: {bot: Bot; state: ChatState; rootBusy: boolean}) {
 const {model, managed, expanded, actions} = useBotToolAccess({bot, state, rootBusy});
 const panelId = useId();
 if (!managed) return null;
 return (
  <div className="mt-3 min-w-0">
   <Button
    type="button"
    variant="outline"
    aria-expanded={expanded}
    aria-controls={panelId}
    disabled={rootBusy}
    onClick={actions.toggle}
   >
    Доступ к инструментам
   </Button>
   {expanded && <ToolPolicy model={model} bot={bot} state={state} rootBusy={rootBusy} panelId={panelId} />}
  </div>
 );
}

type PolicyProps = {
 model: ReturnType<typeof useBotToolAccess>['model'];
 bot: Bot;
 state: ChatState;
 rootBusy: boolean;
 panelId: string;
};

/** Содержимое раскрытой панели только показывает значения и передаёт клики в модель. */
function ToolPolicy({model, bot, state, rootBusy, panelId}: PolicyProps) {
 const {
  policy,
  draft,
  query,
  pending,
  notice,
  error,
  blocked,
  supported,
  owner,
  users,
  missing,
  disabled,
  canSave,
  actions
 } = useBotToolPolicy({model, bot, state, rootBusy});
 return (
  <section
   id={panelId}
   className="bot-tool-policy border-border mt-3 min-w-0 rounded-[var(--radius)] border p-4 [overflow-wrap:anywhere]"
   aria-labelledby={`${panelId}-title`}
   aria-busy={pending}
  >
   <h4 id={`${panelId}-title`} className="mt-0 mb-3 text-[16px] leading-[1.5]">
    Доверенные пользователи
   </h4>
   <p>
    Расширенные инструменты Hermes доступны владельцу и только выбранным пользователям по неизменяемому ID. Роли и
    управление группой не дают этого доступа.
   </p>
   <label className="bot-tool-person bot-tool-owner">
    <Checkbox checked disabled />
    <span>
     <strong>{owner.name}</strong>
     <small>{bot.owner}</small>
     <small>Владелец бота · доступ всегда включён</small>
    </span>
   </label>
   {!supported ? (
    <p role="note">{toolUpgradeNote}</p>
   ) : (
    <>
     <label className="bot-tool-search">
      Поиск пользователей
      <Input
       type="search"
       value={query}
       disabled={blocked}
       placeholder="Имя или ID"
       onChange={event => actions.setQuery(event.target.value)}
      />
     </label>
     <p className="text-muted-foreground text-[12px]">Выбрано {draft.length} из 50 · владелец не учитывается</p>
     <div className="bot-tool-users" aria-label="Пользователи Sombra">
      {users.map(user => (
       <label className="bot-tool-person" key={user.id}>
        <Checkbox
         checked={draft.includes(user.id)}
         disabled={disabled || toolAccessFull(draft, user.id)}
         onCheckedChange={checked => actions.select(user.id, checked === true)}
        />
        <span>
         <strong>{user.name}</strong>
         <small>{user.id}</small>
        </span>
       </label>
      ))}
      {!users.length && <p>{pending ? 'Загрузка настроек…' : 'Пользователи не найдены.'}</p>}
     </div>
     {!!missing.length && (
      <div className="bot-tool-missing">
       <p>Некоторые выбранные ID больше не доступны в списке активных людей. Удалите их перед сохранением.</p>
       {missing.map(id => (
        <Button type="button" variant="outline" key={id} disabled={disabled} onClick={() => actions.select(id, false)}>
         Удалить {id}
        </Button>
       ))}
      </div>
     )}
     <div className="bot-tool-notices" aria-live="polite">
      {pending && <p role="status">{policy ? 'Сохранение / обновление…' : 'Загрузка настроек…'}</p>}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
     </div>
     <div className="flex flex-wrap gap-2 pt-3">
      <Button type="button" disabled={!canSave} onClick={actions.save}>
       Сохранить
      </Button>
      {!policy && !pending && !blocked && (
       <Button type="button" variant="outline" disabled={rootBusy} onClick={actions.retry}>
        Повторить загрузку
       </Button>
      )}
     </div>
    </>
   )}
   <p className="text-muted-foreground text-[12px]">
    Настройки не включают инструменты автоматически. Нужен отдельно развёрнутый плагин в изолированной среде Hermes —
    без общих файлов и памяти Telegram и без произвольного выполнения команд на сервере участниками. Выбранный
    пользователь сможет обращаться к инструментам только там, где ему уже разрешено взаимодействовать с ботом; членство
    в чатах не добавляется. Права окончательно проверяет сервер.
   </p>
  </section>
 );
}
