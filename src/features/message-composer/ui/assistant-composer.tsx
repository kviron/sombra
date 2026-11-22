import {AssistantRuntimeProvider, ComposerPrimitive} from '@assistant-ui/react';
import '@/shared/ui/menu-material.css';
import {ComposerToolbar, ComposerActions, paper, composerInputClass} from '@/shared/ui/elements-composer';
import './assistant-composer.css';
import {useAssistantComposer, type AssistantComposerProps} from '../model/use-assistant-composer';

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
     className={`${paper} sombra-assistant-composer relative flex w-full flex-col gap-2 rounded-[24px] p-2.5 transition-colors`}
     onSubmit={props.onSubmit}
    >
     {props.attachments}
     <ComposerPrimitive.Input
      className={composerInputClass}
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
      className="sombra-composer-menu sombra-menu-surface"
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
         <p>Участники чата</p>
         {items.length ? (
          items.map(item => (
           <ComposerPrimitive.TriggerPopoverItem
            key={item.id}
            item={item}
            tabIndex={-1}
            onMouseDown={e => e.preventDefault()}
           >
            <span className="sombra-mention-avatar">
             {item.metadata?.avatar ? <img src={String(item.metadata.avatar)} alt="" /> : item.label.slice(0, 1)}
            </span>
            <span>
             <strong>{item.label}</strong>
             <small>{item.description}</small>
            </span>
           </ComposerPrimitive.TriggerPopoverItem>
          ))
         ) : (
          <div className="sombra-composer-menu-empty">Нет подходящих участников</div>
         )}
        </>
       )}
      </ComposerPrimitive.TriggerPopoverItems>
     </ComposerPrimitive.TriggerPopover>
     <ComposerPrimitive.TriggerPopover
      char="/"
      matcher={model.matcher}
      adapter={model.commandAdapter}
      className="sombra-composer-menu sombra-menu-surface"
      data-slot="command-menu-content"
      aria-label="Команды переписки и ботов"
     >
      <ComposerPrimitive.TriggerPopover.Action formatter={model.formatter} onExecute={handlers.executeCommand} />
      <ComposerPrimitive.TriggerPopoverItems>
       {items => (
        <>
         <p>Переписка и боты · команды бота вставляются без отправки</p>
         {items.length ? (
          items.map(item => (
           <ComposerPrimitive.TriggerPopoverItem
            key={item.id}
            item={item}
            tabIndex={-1}
            onMouseDown={e => e.preventDefault()}
           >
            <span>
             <strong>{item.label}</strong>
             <small>{item.description}</small>
            </span>
           </ComposerPrimitive.TriggerPopoverItem>
          ))
         ) : (
          <div className="sombra-composer-menu-empty">В этом чате нет подходящих команд</div>
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
