import {useEffect, useRef} from 'react';
import {Dialog} from 'radix-ui';
import {X} from 'lucide-react';
import {type Bot, type BotReasoning, type ChatState} from '@/shared/types';
import {SettingsPanel} from '@/shared/ui/elements-settings';
import {ImageCropDialog} from '@/shared/ui/image-crop-dialog';
import {UserAvatar} from '@/shared/ui/user-avatar';
import {BotToolAccess} from './bot-tool-access';
import {useBotSettings} from '../model/use-bot-settings';
import {useBotModelSettings} from '../model/use-bot-model-settings';
import {type BotConversation, avatarTypeAllowed, canManageBot, reasoningOptions} from '../model/bot-settings-rules';
import './bot-settings-dialog.css';

type Props = {bot: Bot; state: ChatState; refresh: () => Promise<unknown>; onClose: () => void};

export function BotSettingsDialog(props: Props) {
 const {bot, state, onClose} = props;
 const owner = canManageBot(state, bot);
 useEffect(() => {
  if (!owner) onClose();
 }, [owner, onClose]);
 return owner ? <SettingsContent key={`${state.me.id}:${bot.id}:${bot.owner}`} {...props} /> : null;
}

/** Окно только показывает: права, загрузка, черновик и сохранение приходят из модели. */
function SettingsContent({bot, state, refresh, onClose}: Props) {
 const {
  tab,
  loaded,
  name,
  bio,
  aliases,
  conversation,
  busy,
  error,
  notice,
  crop,
  supported,
  dirty,
  disabled,
  invalid,
  invalidAliases,
  preview,
  actions
 } = useBotSettings({bot, state, refresh, onClose});
 const picker = useRef<HTMLInputElement>(null),
  avatarButton = useRef<HTMLButtonElement>(null);
 function closeCrop() {
  actions.setCrop(undefined);
  requestAnimationFrame(() => avatarButton.current?.focus());
 }
 return (
  <Dialog.Root
   open
   onOpenChange={open => {
    if (!open && !busy && !crop) onClose();
   }}
  >
   <Dialog.Portal>
    <Dialog.Overlay className="bot-management-overlay" />
    <Dialog.Content
     className="bot-management-dialog"
     data-bot-settings-dialog
     onEscapeKeyDown={event => {
      if (crop || busy) event.preventDefault();
     }}
     onInteractOutside={event => {
      if (crop || busy) event.preventDefault();
     }}
    >
     <header>
      <div>
       <Dialog.Title>Управление ботом</Dialog.Title>
       <Dialog.Description>{bot.username ? '@' + bot.username : bot.name} · настройки владельца</Dialog.Description>
      </div>
      <button type="button" aria-label="Закрыть настройки бота" disabled={busy} onClick={onClose}>
       <X size={20} />
      </button>
     </header>
     <nav aria-label="Разделы настроек бота">
      {[
       ['general', 'Общее'],
       ['model', 'Модель'],
       ['conversation', 'Общение'],
       ['access', 'Доступ']
      ].map(([id, label]) => (
       <button type="button" key={id} aria-pressed={tab === id} onClick={() => actions.setTab(id)}>
        {label}
       </button>
      ))}
     </nav>
     <div className="bot-management-body">
      {!supported && (
       <p role="note">
        Для управления этим ботом обновите сервер и подключение бота. Настройки доступны только для просмотра.
       </p>
      )}
      {busy && !loaded && <p role="status">Загрузка настроек…</p>}
      {tab === 'general' && (
       <>
        <div className="bot-management-avatar">
         <UserAvatar user={preview} size="md" presence={false} />
         <button type="button" ref={avatarButton} disabled={disabled} onClick={() => picker.current?.click()}>
          Изменить аватар
         </button>
         <button type="button" disabled={disabled} onClick={() => actions.setAvatar('')}>
          Удалить аватар
         </button>
         <input
          hidden
          ref={picker}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          aria-label="Аватар бота"
          onChange={event => {
           const next = event.target.files?.[0];
           event.target.value = '';
           if (next) {
            if (!avatarTypeAllowed(next.type)) {
             actions.setError('Выберите статичное изображение PNG, JPEG или WebP.');
             return;
            }
            actions.setCrop(next);
           }
          }}
         />
        </div>
        <p>Статичное изображение · квадратный PNG 256 × 256. Изменения отправятся только после сохранения.</p>
        <label>
         Имя бота
         <input
          value={loaded ? name : bot.name}
          maxLength={32}
          disabled={disabled}
          onChange={event => actions.setName(event.target.value)}
         />
        </label>
        <label>
         О боте
         <textarea
          value={bio}
          maxLength={512}
          disabled={disabled}
          onChange={event => actions.setBio(event.target.value)}
         />
        </label>
        <p>Уникальное имя: {bot.username ? '@' + bot.username : 'не задано'} · не изменяется здесь.</p>
        <p>Личность и инструменты Сомбры можно настраивать владельцу в личной переписке</p>
       </>
      )}
      <div className="bot-model-settings" hidden={tab !== 'model'}>
       <ModelSettings bot={bot} state={state} refresh={refresh} rootBusy={busy} />
      </div>
      {tab === 'conversation' && (
       <>
        <fieldset disabled={disabled}>
         <legend>Как обращаться к боту в группе</legend>
         {[
          ['addressed', 'Только команды и @упоминания'],
          ['name_dialog', 'Обращение по имени и диалог']
         ].map(([mode, label]) => (
          <label className="bot-management-choice" key={mode}>
           <input
            type="radio"
            name="bot-conversation-mode"
            checked={conversation?.mode === mode}
            onChange={() => actions.updateConversation({mode: mode as BotConversation['mode']})}
           />
           {label}
          </label>
         ))}
         <label>
          Имена для обращения
          <textarea value={aliases} onChange={event => actions.setAliases(event.target.value)} />
         </label>
         <p>
          Через запятую или с новой строки: до 8 имён, каждое от 2 до 32 символов. Общие обращения «all», «everyone»,
          «here», «все» не допускаются.
         </p>
         <label>
          Окно продолжения, секунд
          <input
           type="number"
           min={0}
           max={600}
           value={conversation?.followupSeconds ?? 180}
           onChange={event =>
            actions.updateConversation({
             followupSeconds: event.target.value === '' ? NaN : Number(event.target.value)
            })
           }
          />
         </label>
         <label>
          Сообщений в продолжении
          <input
           type="number"
           min={0}
           max={20}
           value={conversation?.followupMessages ?? 8}
           onChange={event =>
            actions.updateConversation({
             followupMessages: event.target.value === '' ? NaN : Number(event.target.value)
            })
           }
          />
         </label>
         <p>
          Обычно 180 секунд и 8 сообщений. Продолжать диалог может только тот же участник; сообщения остальных не
          захватываются. 0 отключает продолжение.
         </p>
         <label className="bot-management-choice">
          <input
           type="checkbox"
           checked={conversation?.reactions ?? false}
           onChange={event => actions.updateConversation({reactions: event.target.checked})}
          />
          Реакции бота
         </label>
        </fieldset>
        {invalidAliases && <p role="alert">Проверьте имена для обращения.</p>}
       </>
      )}
      {tab === 'access' && <BotToolAccess bot={bot} state={state} rootBusy={busy} />}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
      {supported && !loaded && !busy && (
       <button type="button" onClick={actions.retry}>
        Повторить загрузку
       </button>
      )}
     </div>
     <footer>
      <span>{dirty ? 'Есть несохранённые изменения' : ''}</span>
      <button type="button" disabled={busy} onClick={onClose}>
       Отмена
      </button>
      <button type="button" disabled={disabled || invalid || !dirty} onClick={actions.save}>
       {busy ? 'Сохранение…' : 'Сохранить'}
      </button>
     </footer>
     {crop && (
      <ImageCropDialog
       file={crop}
       kind="avatar"
       onClose={closeCrop}
       onConfirm={result => {
        actions.setAvatar(result.dataUrl);
        closeCrop();
       }}
      />
     )}
    </Dialog.Content>
   </Dialog.Portal>
  </Dialog.Root>
 );
}

/** Вкладка «Модель»: значения, каталог и сохранение приходят из модели среза. */
function ModelSettings({
 bot,
 state,
 refresh,
 rootBusy
}: {
 bot: Bot;
 state: ChatState;
 refresh: () => Promise<unknown>;
 rootBusy: boolean;
}) {
 const {
  loaded,
  model,
  trimmed,
  reasoning,
  pending,
  error,
  notice,
  catalog,
  invalidModel,
  dirty,
  disabled,
  modelOptions,
  currentModel,
  currentReasoning,
  actions
 } = useBotModelSettings({bot, state, refresh, rootBusy});
 return (
  <section aria-labelledby="bot-model-settings-title" aria-busy={pending}>
   <h3 id="bot-model-settings-title">Модель и размышление</h3>
   <p className="bot-model-note">
    Значения применяет Hermes: пустое значение означает его текущие модель и уровень по умолчанию, которые определяет
    провайдер. Каталог допустимых моделей публикует провайдер, сервер хранит только выбранный безопасный идентификатор.
    Изменения вступят в силу после ответа сервера.
   </p>
   {pending && !loaded && <p role="status">Загрузка настроек модели…</p>}
   {!loaded && !pending && (
    <button type="button" className="bot-model-retry" disabled={rootBusy} onClick={actions.retry}>
     Повторить загрузку
    </button>
   )}
   {loaded && (
    <>
     <SettingsPanel
      className="elements-settings"
      model={trimmed}
      models={modelOptions}
      modelLabel={value => value || 'По умолчанию'}
      onModelChange={value => actions.edit({model: value})}
      reasoning={{
       value: reasoning,
       options: reasoningOptions,
       onChange: value => actions.edit({reasoning: value as BotReasoning})
      }}
      modelInput={
       catalog.length
        ? undefined
        : {
           value: model,
           onChange: value => actions.edit({model: value}),
           invalid: invalidModel,
           hint: invalidModel
            ? 'Недопустимый идентификатор: только A–Z, a–z, 0–9 и - _ . : / @ +, до 120 символов.'
            : 'Пустое значение — модель по умолчанию Hermes. Допустимы A–Z, a–z, 0–9 и - _ . : / @ +, до 120 символов.'
          }
      }
      disabled={disabled}
     />
     <p className="bot-model-current">
      На сервере: {currentModel} · {currentReasoning}
     </p>
    </>
   )}
   {notice && <p role="status">{notice}</p>}
   {error && <p role="alert">{error}</p>}
   <div className="bot-model-actions">
    <button
     type="button"
     aria-label="Сохранить модель и уровень размышления"
     disabled={disabled || !dirty || invalidModel}
     onClick={actions.save}
    >
     {pending && loaded ? 'Сохранение…' : 'Сохранить'}
    </button>
    <span>{dirty ? 'Есть несохранённые изменения' : ''}</span>
   </div>
  </section>
 );
}
