import {AssistantRuntimeProvider, ComposerPrimitive} from '@assistant-ui/react';
import '@/shared/ui/menu-material.css';
import {cn} from '@/shared/lib';
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
 'absolute right-auto bottom-[calc(100%+12px)] left-0 z-40 max-h-[min(340px,50vh)] w-[min(420px,100%)] min-w-0 overflow-auto p-2';
/** Поле ввода: родные рамку, тень и resize снимает только оно само; border-current
   повторяет border: 0 из прежнего правила, иначе слой base вернёт цвет рамки. */
const composerTextareaClass = 'min-w-0 resize-none border-0 border-current py-2.5 leading-[24px] text-foreground';

/**
 * Поле помощника только раскладывает разметку: текст, подсказки, упоминания и
 * музыкальные команды живут в модели среза.
 */
export function AssistantComposer(props: AssistantComposerProps) {
 const model = useAssistantComposer(props);
 const {handlers, runtime} = model;
 return (
  <AssistantRuntimeProvider runtime={runtime}>
   <ComposerPrimitive.TriggerPopoverRoot>
    <ComposerPrimitive.Root
     onKeyDownCapture={handlers.keyDownCapture}
     data-slot="composer"
     className={cn(
      paper,
      'sombra-assistant-composer relative flex w-full flex-col gap-2 rounded-[24px] p-2.5 transition-colors'
     )}
     onSubmit={props.onSubmit}
    >
     {props.attachments}
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
     <ComposerToolbar>
      <ComposerActions>{props.children}</ComposerActions>
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
     </ComposerToolbar>
     <ComposerPrimitive.TriggerPopover
      char="@"
      matcher={model.matcher}
      adapter={model.mentionAdapter}
      className={cn('sombra-composer-menu sombra-menu-surface', menuPopoverClass)}
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
            <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-[50%] bg-[var(--accent,#41434e)] text-[16px]">
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
      className={cn('sombra-composer-menu sombra-menu-surface', menuPopoverClass)}
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
