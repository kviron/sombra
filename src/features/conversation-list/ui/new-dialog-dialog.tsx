import {useId} from 'react';
import {Checkbox, Dialog as RadixDialog} from 'radix-ui';
import {Check, LoaderCircle, Search, X} from 'lucide-react';
import {type ChatState, type Dialog, type User} from '@/shared/types';
import {Button} from '@/shared/ui/button';
import {Input} from '@/shared/ui/input';
import {UserAvatar} from '@/shared/ui/user-avatar';
import {UserRow} from '@/entities/user';
import {useNewDialog} from '../model/use-new-dialog';
import './new-dialog-dialog.css';

export type NewDialogDialogProps = {
 state: ChatState;
 onClose: () => void;
 onCreated: (dialog: Dialog) => void;
 refresh: () => Promise<unknown>;
};

// The checkbox is a sibling, never a button nested in the common user row.
function SelectionRow({
 user,
 checked,
 disabled,
 friend,
 onChange
}: {
 user: User;
 checked: boolean;
 disabled: boolean;
 friend: boolean;
 onChange: () => void;
}) {
 return (
  <div
   className="hover:bg-accent data-[selected=true]:bg-accent flex min-w-0 items-center gap-2 rounded-lg pr-3"
   data-selected={checked || undefined}
  >
   <button
    type="button"
    className="min-w-0 flex-1 cursor-pointer rounded-lg border-0 bg-transparent px-0 py-1 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-50"
    disabled={disabled}
    onClick={onChange}
    aria-pressed={checked}
    aria-label={`${checked ? 'Убрать' : 'Выбрать'}: ${user.name}`}
   >
    <UserRow
     identity={user}
     menu={false}
     selected={checked}
     subtitle={user.bot ? 'Бот · только личный диалог' : friend ? 'В друзьях' : 'Общая группа'}
    />
   </button>
   <Checkbox.Root
    className="border-input bg-background text-primary-foreground data-[state=checked]:border-primary data-[state=checked]:bg-primary grid size-[22px] shrink-0 cursor-pointer place-items-center rounded-[5px] border p-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-50 [&>span]:grid [&>span]:place-items-center"
    checked={checked}
    disabled={disabled}
    onCheckedChange={onChange}
    aria-label={`Выбрать: ${user.name}`}
   >
    <Checkbox.Indicator>
     <Check size={14} aria-hidden="true" />
    </Checkbox.Indicator>
   </Checkbox.Root>
  </div>
 );
}

export function NewDialogDialog({state, onClose, onCreated, refresh}: NewDialogDialogProps) {
 const id = useId();
 const {
  query,
  selected,
  name,
  busy,
  error,
  selectedUsers,
  people,
  locked,
  limitNote,
  emptyText,
  errorText,
  submitLabel,
  isFriend,
  unavailable,
  isSubmitting,
  actions
 } = useNewDialog({state, refresh, onCreated});

 return (
  <RadixDialog.Root
   open
   onOpenChange={open => {
    if (!open && !isSubmitting()) onClose();
   }}
  >
   <RadixDialog.Portal>
    <RadixDialog.Overlay className="new-dialog-overlay" />
    <RadixDialog.Content className="new-dialog-dialog fixed top-1/2 left-1/2 z-[111] flex max-h-[calc(100dvh_-_32px)] w-[min(480px,calc(100vw_-_32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden">
     <header className="new-dialog-header flex items-start justify-between gap-4 px-6 pt-6 pb-4">
      <div>
       <RadixDialog.Title className="m-0 text-xl leading-[1.4] font-[650]">Новый чат</RadixDialog.Title>
       <RadixDialog.Description className="text-muted-foreground m-0 mt-1 text-sm leading-normal">
        Выберите друзей или участников общих групп.
       </RadixDialog.Description>
      </div>
      <RadixDialog.Close asChild>
       <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-9 shrink-0"
        disabled={busy}
        aria-label="Закрыть"
       >
        <X size={20} />
       </Button>
      </RadixDialog.Close>
     </header>
     <form
      className="new-dialog-form flex min-h-0 flex-1 flex-col"
      onSubmit={event => {
       event.preventDefault();
       actions.submit();
      }}
      aria-busy={busy}
     >
      <div className="new-dialog-body min-h-0 overflow-y-auto overscroll-contain px-6 pb-4">
       <div className="new-dialog-search [&>svg]:text-muted-foreground relative [&>svg]:pointer-events-none [&>svg]:absolute [&>svg]:top-[11px] [&>svg]:left-3">
        <Search size={18} aria-hidden="true" />
        <Input
         autoFocus
         aria-label="Поиск по имени"
         placeholder="Поиск по имени"
         value={query}
         onChange={event => actions.setQuery(event.target.value)}
         disabled={locked}
        />
       </div>
       {selectedUsers.length > 0 && (
        <ul className="new-dialog-chips mt-4 flex list-none flex-wrap gap-2 p-0" aria-label="Выбранные участники">
         {selectedUsers.map(user => (
          <li key={user.id} className="max-w-full min-w-0">
           <Button
            type="button"
            variant="secondary"
            className="new-dialog-chip"
            disabled={locked}
            onClick={() => actions.toggle(user.id)}
            aria-label={`Убрать: ${user.name}`}
           >
            <UserAvatar user={user} size="xs" presence={false} decorative decoration={user.decorations?.avatar} />
            <span>{user.name}</span>
            <X size={14} aria-hidden="true" />
           </Button>
          </li>
         ))}
        </ul>
       )}
       <p
        className="new-dialog-count text-muted-foreground mt-4 mb-2 text-xs leading-normal"
        id={`${id}-limit`}
        aria-live="polite"
       >
        Выбрано: {selected.length} из 9{limitNote}
       </p>
       {selected.length > 1 && (
        <div className="new-dialog-name my-4 grid gap-2">
         <label htmlFor={`${id}-name`} className="text-sm font-medium">
          Название группы <span className="text-muted-foreground ml-1 font-normal">необязательно</span>
         </label>
         <Input
          id={`${id}-name`}
          maxLength={60}
          placeholder="Как назовём группу?"
          value={name}
          onChange={event => actions.setName(event.target.value)}
          disabled={locked}
         />
        </div>
       )}
       <div
        className="new-dialog-people grid gap-1"
        role="group"
        aria-label="Друзья и участники общих групп"
        aria-describedby={`${id}-limit`}
       >
        {people.map(user => (
         <SelectionRow
          key={user.id}
          user={user}
          checked={selected.includes(user.id)}
          disabled={unavailable(user)}
          friend={isFriend(user.id)}
          onChange={() => actions.toggle(user.id)}
         />
        ))}
        {!people.length && (
         <p className="new-dialog-empty text-muted-foreground m-0 px-2 py-6 text-center text-sm leading-normal">
          {emptyText}
         </p>
        )}
       </div>
      </div>
      <footer className="new-dialog-footer border-border shrink-0 border-t px-6 pt-4 pb-6">
       {error && (
        <p
         className="new-dialog-error text-destructive m-0 mb-3 text-sm leading-normal [overflow-wrap:anywhere]"
         role="alert"
        >
         {errorText}
        </p>
       )}
       <div className="new-dialog-actions flex justify-end gap-2">
        <RadixDialog.Close asChild>
         <Button variant="outline" type="button" disabled={busy}>
          Отмена
         </Button>
        </RadixDialog.Close>
        <Button type="submit" disabled={busy || selected.length === 0}>
         {busy && <LoaderCircle className="new-dialog-spinner" size={16} aria-hidden="true" />}
         {submitLabel}
        </Button>
       </div>
      </footer>
     </form>
    </RadixDialog.Content>
   </RadixDialog.Portal>
  </RadixDialog.Root>
 );
}
