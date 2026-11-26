import {AssistantRuntimeProvider, ComposerPrimitive} from '@assistant-ui/react';
import '@/shared/ui/menu-material.css';
import {cn, useRenderStorm} from '@/shared/lib';
import {ComposerToolbar, ComposerActions, paper, composerInputClass} from '@/shared/ui/elements-composer';
import './assistant-composer.css';
import {useAssistantComposer, type AssistantComposerProps} from '../model/use-assistant-composer';

/** Пункт подсказки: одинаков для упоминаний и команд, раскладку задают утилиты. */
const menuItemClass =
 'flex h-auto min-h-[54px] w-full items-center justify-start gap-3 rounded-[10px] bg-transparent p-[8px_12px] text-left text-inherit';
/** Подпись пункта: имя и описание держатся в одной колонке и переносятся по словам. */
const menuTextClass = 'flex min-w-0 flex-col items-start gap-0.5';
const menuNameClass = 'text-[14px] font-semibold whitespace-normal [overflow-wrap:anywhere]';
const menuHintClass = 'text-muted-foreground text-[12px] whitespace-normal [overflow-wrap:anywhere]';
const menuLabelClass = 'text-muted-foreground m-[4px_8px_8px] text-[12px]';
const menuEmptyClass = 'text-muted-foreground p-3 text-[14px]';
/** Попап позиционируется от строки ввода: geometry уходит в утилиты, радиус — в CSS. */
const menuPopoverClass =
 'sombra-composer-menu sombra-menu-surface sombra-picker-material absolute inset-x-0 bottom-[calc(100%+12px)] z-40 max-h-[min(340px,50vh)] min-w-0 overflow-auto p-2 shadow-lg';
/** Поле ввода: родные рамку, тень и resize снимает только оно само; border-current
   повторяет border: 0 из прежнего правила, иначе слой base вернёт цвет рамки. */
const composerTextareaClass =
 'text-foreground min-h-8 min-w-0 flex-1 resize-none border-0 border-current px-1 py-1 leading-6';

/**
 * Поле помощника только раскладывает разметку: текст, подсказки, упоминания и
 * музыкальные команды живут в модели среза.
 */
export function AssistantComposer(props: AssistantComposerProps) {
 useRenderStorm('AssistantComposer');
 const model = useAssistantComposer(props);
 const {handlers, runtime} = model;
 return (
  <AssistantRuntimeProvider runtime={runtime}>
   <ComposerPrimitive.TriggerPopoverRoot>
    <ComposerPrimitive.Root
     onKeyDownCapture={handlers.keyDownCapture}
     data-slot="composer"
     className={cn(paper, 'sombra-assistant-composer relative flex w-full flex-col rounded-xl px-2 transition-colors')}
     onSubmit={props.onSubmit}
    >
     {props.attachments}
     {props.suggestions}
     <ComposerToolbar className="min-h-[calc(var(--chat-bottom-row-height,58px)-2px)] min-w-0 items-end gap-1 py-3">
      {props.leadingActions}
      <ComposerPrimitive.Input
       className={cn(composerInputClass, composerTextareaClass)}
       data-slot="composer-input"
       ref={props.textareaRef}
       rows={1}
       maxRows={5}
       maxLength={2000}
       aria-label="Сообщение"
       role="combobox"
       aria-autocomplete="list"
       placeholder={props.placeholder}
       cancelOnEscape={false}
       addAttachmentOnPaste={false}
       unstable_focusOnRunStart={false}
       unstable_focusOnScrollToBottom={false}
       onPaste={props.onPaste}
      />
      <ComposerActions className="shrink-0 gap-1">
       {props.trailingActions}
       {props.hasAttachment && !props.draft.trim() ? (
        props.sendButton
       ) : (
        <ComposerPrimitive.Send
         asChild
         disabled={props.sendDisabled}
         onClick={event => {
          event.preventDefault();
          event.currentTarget.closest('form')?.requestSubmit();
         }}
        >
         {props.sendButton}
        </ComposerPrimitive.Send>
       )}
      </ComposerActions>
     </ComposerToolbar>
     <ComposerPrimitive.TriggerPopover
      char="@"
      matcher={model.matcher}
      adapter={model.mentionAdapter}
      className={menuPopoverClass}
      data-slot="mention-menu-content"
      aria-label="Участники чата"
     >
      <ComposerPrimitive.TriggerPopover.Directive
       formatter={model.mentionFormatter}
       onInserted={handlers.mentionInserted}
      />
      <ComposerPrimitive.TriggerPopoverItems>
       {items => (
        <>
         <p className={menuLabelClass}>Участники чата</p>
         {items.length ? (
          items.map(item => (
           <ComposerPrimitive.TriggerPopoverItem
            key={item.id}
            item={item}
            tabIndex={-1}
            className={menuItemClass}
            onMouseDown={e => e.preventDefault()}
           >
            <span className="bg-muted grid size-9 shrink-0 place-items-center overflow-hidden rounded-[50%] text-[16px]">
             {item.metadata?.avatar ? (
              <img className="size-full object-cover" src={String(item.metadata.avatar)} alt="" />
             ) : (
              item.label.slice(0, 1)
             )}
            </span>
            <span className={menuTextClass}>
             <strong className={menuNameClass}>{item.label}</strong>
             <small className={menuHintClass}>{item.description}</small>
            </span>
           </ComposerPrimitive.TriggerPopoverItem>
          ))
         ) : (
          <div className={menuEmptyClass}>Нет подходящих участников</div>
         )}
        </>
       )}
      </ComposerPrimitive.TriggerPopoverItems>
     </ComposerPrimitive.TriggerPopover>
     <ComposerPrimitive.TriggerPopover
      char="/"
      matcher={model.matcher}
      adapter={model.commandAdapter}
      className={menuPopoverClass}
      data-slot="command-menu-content"
      aria-label="Команды переписки и ботов"
     >
      <ComposerPrimitive.TriggerPopover.Action formatter={model.formatter} onExecute={handlers.executeCommand} />
      <ComposerPrimitive.TriggerPopoverItems>
       {items => (
        <>
         <p className={menuLabelClass}>Переписка и боты · команды бота вставляются без отправки</p>
         {items.length ? (
          items.map(item => (
           <ComposerPrimitive.TriggerPopoverItem
            key={item.id}
            item={item}
            tabIndex={-1}
            className={menuItemClass}
            onMouseDown={e => e.preventDefault()}
           >
            <span className={menuTextClass}>
             <strong className={menuNameClass}>{item.label}</strong>
             <small className={menuHintClass}>{item.description}</small>
            </span>
           </ComposerPrimitive.TriggerPopoverItem>
          ))
         ) : (
          <div className={menuEmptyClass}>В этом чате нет подходящих команд</div>
         )}
        </>
       )}
      </ComposerPrimitive.TriggerPopoverItems>
     </ComposerPrimitive.TriggerPopover>
    </ComposerPrimitive.Root>
   </ComposerPrimitive.TriggerPopoverRoot>
  </AssistantRuntimeProvider>
 );
}
