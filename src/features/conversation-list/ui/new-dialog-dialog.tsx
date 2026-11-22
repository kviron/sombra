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
  <div className="new-dialog-selection" data-selected={checked || undefined}>
   <button
    type="button"
    className="new-dialog-person"
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
    className="new-dialog-checkbox"
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
    <RadixDialog.Content className="new-dialog-dialog">
     <header className="new-dialog-header">
      <div>
       <RadixDialog.Title>Новый чат</RadixDialog.Title>
       <RadixDialog.Description>Выберите друзей или участников общих групп.</RadixDialog.Description>
      </div>
      <RadixDialog.Close asChild>
       <Button type="button" variant="ghost" size="icon" disabled={busy} aria-label="Закрыть">
        <X size={20} />
       </Button>
      </RadixDialog.Close>
     </header>
     <form
      className="new-dialog-form"
      onSubmit={event => {
       event.preventDefault();
       actions.submit();
      }}
      aria-busy={busy}
     >
      <div className="new-dialog-body">
       <div className="new-dialog-search">
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
        <ul className="new-dialog-chips" aria-label="Выбранные участники">
         {selectedUsers.map(user => (
          <li key={user.id}>
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
       <p className="new-dialog-count" id={`${id}-limit`} aria-live="polite">
        Выбрано: {selected.length} из 9{limitNote}
       </p>
       {selected.length > 1 && (
        <div className="new-dialog-name">
         <label htmlFor={`${id}-name`}>
          Название группы <span>необязательно</span>
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
        className="new-dialog-people"
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
        {!people.length && <p className="new-dialog-empty">{emptyText}</p>}
       </div>
      </div>
      <footer className="new-dialog-footer">
       {error && (
        <p className="new-dialog-error" role="alert">
         {errorText}
        </p>
       )}
       <div className="new-dialog-actions">
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
