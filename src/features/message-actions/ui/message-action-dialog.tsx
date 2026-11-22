import type {RefObject} from 'react';
import {AlertDialog, Dialog} from 'radix-ui';
import {type ChatMessage} from '@/shared/types';
import {Button} from '@/shared/ui/button';
import {useMessageAction} from '../model/use-message-action';

type Props = {
 mode: 'edit' | 'delete';
 message: ChatMessage;
 author: boolean;
 canDeleteEveryone?: boolean;
 trigger: RefObject<HTMLElement | null>;
 refresh: () => Promise<unknown>;
 onClose: () => void;
};

const overlayClass = 'sombra-modal-overlay fixed inset-0 z-[110] bg-black/60';
const contentClass =
 'fixed top-1/2 left-1/2 z-[111] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-popover p-5 text-popover-foreground shadow-xl';
const titleClass = 'text-base font-semibold';
const actionsClass = 'mt-5 flex justify-end gap-2';

export function MessageActionDialog({
 mode,
 message,
 author,
 canDeleteEveryone = false,
 trigger,
 refresh,
 onClose
}: Props) {
 const model = useMessageAction({mode, message, author, canDeleteEveryone, refresh, onClose});
 function restoreFocus(event: Event) {
  event.preventDefault();
  trigger.current?.focus({preventScroll: true});
 }
 const submitError = model.error && (
  <p className="text-destructive mt-3 text-sm" role="alert">
   {model.error}
  </p>
 );

 if (mode === 'delete')
  return (
   <AlertDialog.Root open onOpenChange={model.actions.close}>
    <AlertDialog.Portal>
     <AlertDialog.Overlay className={overlayClass} />
     <AlertDialog.Content className={contentClass} onCloseAutoFocus={restoreFocus}>
      <AlertDialog.Title className={titleClass}>Удалить сообщение?</AlertDialog.Title>
      <AlertDialog.Description className="text-muted-foreground mt-2 text-sm">
       {model.deleteDescription}
      </AlertDialog.Description>
      <form
       onSubmit={event => {
        event.preventDefault();
        model.actions.submit();
       }}
      >
       {model.mayDeleteEveryone && (
        <label className="mt-4 flex w-fit cursor-pointer items-center gap-2 text-sm">
         <input
          type="checkbox"
          className="accent-primary size-4"
          checked={model.removeForEveryone}
          onChange={event => model.actions.setForEveryone(event.target.checked)}
          disabled={model.busy}
         />
         Удалить для всех
        </label>
       )}
       {submitError}
       <div className={actionsClass}>
        <AlertDialog.Cancel asChild>
         <Button variant="outline" type="button" disabled={model.busy}>
          Отмена
         </Button>
        </AlertDialog.Cancel>
        <Button variant="destructive" type="submit" disabled={model.busy}>
         Удалить
        </Button>
       </div>
      </form>
     </AlertDialog.Content>
    </AlertDialog.Portal>
   </AlertDialog.Root>
  );

 return (
  <Dialog.Root open onOpenChange={model.actions.close}>
   <Dialog.Portal>
    <Dialog.Overlay className={overlayClass} />
    <Dialog.Content className={contentClass} onCloseAutoFocus={restoreFocus} aria-describedby={undefined}>
     <Dialog.Title className={titleClass}>Редактировать сообщение</Dialog.Title>
     <form
      onSubmit={event => {
       event.preventDefault();
       model.actions.submit();
      }}
     >
      <textarea
       aria-label="Текст сообщения"
       aria-invalid={model.tooLong}
       className="border-input bg-background focus-visible:ring-ring mt-3 block max-h-60 min-h-24 w-full resize-y rounded-md border p-2 text-sm outline-none focus-visible:ring-2"
       rows={4}
       value={model.text}
       disabled={model.busy}
       onChange={event => model.actions.setText(event.target.value)}
      />
      {model.tooLong && <p className="text-destructive mt-2 text-sm">Максимум 2000 символов.</p>}
      {submitError}
      <div className={actionsClass}>
       <Dialog.Close asChild>
        <Button variant="outline" type="button" disabled={model.busy}>
         Отмена
        </Button>
       </Dialog.Close>
       <Button type="submit" disabled={model.busy || !model.canSave}>
        Сохранить
       </Button>
      </div>
     </form>
    </Dialog.Content>
   </Dialog.Portal>
  </Dialog.Root>
 );
}
