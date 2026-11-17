import {useState, type FormEvent, type RefObject} from 'react';
import {AlertDialog, Dialog} from 'radix-ui';
import {api, type ChatMessage} from '@/shared/api/backend';
import {Button} from '@/shared/ui/button';

type Props={
 mode:'edit'|'delete';
 message:ChatMessage;
 author:boolean;
 canDeleteEveryone?:boolean;
 trigger:RefObject<HTMLElement|null>;
 refresh:()=>Promise<unknown>;
 onClose:()=>void;
};

const overlayClass='fixed inset-0 z-[110] bg-black/60';
const contentClass='fixed top-1/2 left-1/2 z-[111] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-popover p-5 text-popover-foreground shadow-xl';
const titleClass='text-base font-semibold';
const actionsClass='mt-5 flex justify-end gap-2';

export function MessageActionDialog({mode,message,author,canDeleteEveryone=false,trigger,refresh,onClose}:Props){
 const [text,setText]=useState(message.text||'');
 const [forEveryone,setForEveryone]=useState(false);
 const mayDeleteEveryone=author||canDeleteEveryone;
 const removeForEveryone=mayDeleteEveryone&&forEveryone;
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const trimmed=text.trim();
 const tooLong=[...trimmed].length>2000;
 const canSave=!!trimmed&&!tooLong&&trimmed!==message.text;

 function close(open:boolean){if(!open&&!busy)onClose()}
 function restoreFocus(event:Event){
  event.preventDefault();
  trigger.current?.focus({preventScroll:true});
 }
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  if(busy||(mode==='edit'&&!canSave))return;
  setBusy(true);
  setError('');
  try{
   if(mode==='edit')await api('update_message',{message:message.id,text:trimmed});
   else await api('delete_message',{message:message.id,for_everyone:removeForEveryone});
   await refresh();
   onClose();
  }catch(err){setError((err as Error).message)}
  finally{setBusy(false)}
 }
 const submitError=error&&<p className="mt-3 text-sm text-destructive" role="alert">{error}</p>;

 if(mode==='delete')return <AlertDialog.Root open onOpenChange={close}>
  <AlertDialog.Portal>
   <AlertDialog.Overlay className={overlayClass}/>
   <AlertDialog.Content className={contentClass} onCloseAutoFocus={restoreFocus}>
    <AlertDialog.Title className={titleClass}>Удалить сообщение?</AlertDialog.Title>
    <AlertDialog.Description className="mt-2 text-sm text-muted-foreground">
     {removeForEveryone?'Сообщение исчезнет у всех участников чата.':'Сообщение исчезнет только у вас.'}
    </AlertDialog.Description>
    <form onSubmit={submit}>
     {mayDeleteEveryone&&<label className="mt-4 flex w-fit cursor-pointer items-center gap-2 text-sm">
      <input type="checkbox" className="size-4 accent-primary" checked={removeForEveryone} onChange={event=>setForEveryone(event.target.checked)} disabled={busy}/>
      Удалить для всех
     </label>}
     {submitError}
     <div className={actionsClass}>
      <AlertDialog.Cancel asChild><Button variant="outline" type="button" disabled={busy}>Отмена</Button></AlertDialog.Cancel>
      <Button variant="destructive" type="submit" disabled={busy}>Удалить</Button>
     </div>
    </form>
   </AlertDialog.Content>
  </AlertDialog.Portal>
 </AlertDialog.Root>;

 return <Dialog.Root open onOpenChange={close}>
  <Dialog.Portal>
   <Dialog.Overlay className={overlayClass}/>
   <Dialog.Content className={contentClass} onCloseAutoFocus={restoreFocus} aria-describedby={undefined}>
    <Dialog.Title className={titleClass}>Редактировать сообщение</Dialog.Title>
    <form onSubmit={submit}>
     <textarea
      aria-label="Текст сообщения"
      aria-invalid={tooLong}
      className="mt-3 block min-h-24 max-h-60 w-full resize-y rounded-md border border-input bg-background p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      rows={4}
      value={text}
      disabled={busy}
      onChange={event=>setText(event.target.value)}
     />
     {tooLong&&<p className="mt-2 text-sm text-destructive">Максимум 2000 символов.</p>}
     {submitError}
     <div className={actionsClass}>
      <Dialog.Close asChild><Button variant="outline" type="button" disabled={busy}>Отмена</Button></Dialog.Close>
      <Button type="submit" disabled={busy||!canSave}>Сохранить</Button>
     </div>
    </form>
   </Dialog.Content>
  </Dialog.Portal>
 </Dialog.Root>;
}
