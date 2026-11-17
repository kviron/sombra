import { useId, useRef, useState, type FormEvent } from 'react';
import { Checkbox, Dialog as RadixDialog } from 'radix-ui';
import { Check, LoaderCircle, Search, X } from 'lucide-react';
import { api, type ChatState, type Dialog, type User } from '@/shared/api/backend';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { UserAvatar } from '@/shared/ui/user-avatar';
import { UserRow } from './user-row';
import './new-dialog-dialog.css';

export type NewDialogDialogProps = {
  state: ChatState;
  onClose: () => void;
  onCreated: (dialog: Dialog) => void;
  refresh: () => Promise<unknown>;
};

// The checkbox is a sibling, never a button nested in the common user row.
function SelectionRow({ user, checked, disabled, friend, onChange }: {
  user: User;
  checked: boolean;
  disabled: boolean;
  friend: boolean;
  onChange: () => void;
}) {
  return <div className="new-dialog-selection" data-selected={checked || undefined}>
    <button type="button" className="new-dialog-person" disabled={disabled} onClick={onChange} aria-pressed={checked} aria-label={`${checked ? 'Убрать' : 'Выбрать'}: ${user.name}`}>
      <UserRow identity={user} menu={false} selected={checked} subtitle={friend ? 'В друзьях' : 'Общая группа'} />
    </button>
    <Checkbox.Root className="new-dialog-checkbox" checked={checked} disabled={disabled} onCheckedChange={onChange} aria-label={`Выбрать: ${user.name}`}>
      <Checkbox.Indicator><Check size={14} aria-hidden="true" /></Checkbox.Indicator>
    </Checkbox.Root>
  </div>;
}

export function NewDialogDialog({ state, onClose, onCreated, refresh }: NewDialogDialogProps) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<Dialog | null>(null);
  const submitting = useRef(false);
  const friendIds = new Set(state.friends.filter(friend => friend.accepted && (friend.from === state.me.id || friend.to === state.me.id)).map(friend => friend.from === state.me.id ? friend.to : friend.from));
  const commonIds = new Set(state.groups.filter(group => group.members.includes(state.me.id)).flatMap(group => group.members));
  const people = state.users.filter((user, index, all) => user.id !== state.me.id && (friendIds.has(user.id) || commonIds.has(user.id)) && all.findIndex(other => other.id === user.id) === index);
  const selectedUsers = selected.map(userId => people.find(user => user.id === userId)).filter((user): user is User => !!user);
  const search = query.trim().toLocaleLowerCase('ru');
  const visible = people.filter(user => user.name.toLocaleLowerCase('ru').includes(search)).sort((a, b) => Number(friendIds.has(b.id)) - Number(friendIds.has(a.id)) || a.name.localeCompare(b.name, 'ru'));
  const locked = busy || !!created;

  function toggle(userId: string) {
    if (locked) return;
    setSelected(current => current.includes(userId) ? current.filter(value => value !== userId) : current.length < 9 ? [...current, userId] : current);
    setError('');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || selected.length < 1 || selected.length > 9) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      // Keep a successful creation across refresh retries; never create a second group.
      const result = created ?? await api<Dialog>('create_dialog', {
        members: selected,
        ...(selected.length > 1 ? { name: name.trim() || selectedUsers.map(user=>user.name).join(', ').slice(0,60) } : {}),
      });
      setCreated(result);
      await refresh();
      onCreated(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось создать чат. Попробуйте ещё раз.');
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return <RadixDialog.Root open onOpenChange={open => { if (!open && !submitting.current) onClose(); }}>
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="new-dialog-overlay" />
      <RadixDialog.Content className="new-dialog-dialog">
        <header className="new-dialog-header">
          <div>
            <RadixDialog.Title>Новый чат</RadixDialog.Title>
            <RadixDialog.Description>Выберите друзей или участников общих групп.</RadixDialog.Description>
          </div>
          <RadixDialog.Close asChild><Button type="button" variant="ghost" size="icon" disabled={busy} aria-label="Закрыть"><X size={20} /></Button></RadixDialog.Close>
        </header>
        <form className="new-dialog-form" onSubmit={submit} aria-busy={busy}>
          <div className="new-dialog-body">
            <div className="new-dialog-search"><Search size={18} aria-hidden="true" /><Input autoFocus aria-label="Поиск по имени" placeholder="Поиск по имени" value={query} onChange={event => setQuery(event.target.value)} disabled={locked} /></div>
            {selectedUsers.length > 0 && <ul className="new-dialog-chips" aria-label="Выбранные участники">{selectedUsers.map(user => <li key={user.id}>
              <Button type="button" variant="secondary" className="new-dialog-chip" disabled={locked} onClick={() => toggle(user.id)} aria-label={`Убрать: ${user.name}`}>
                <UserAvatar user={user} size="xs" presence={false} decorative /><span>{user.name}</span><X size={14} aria-hidden="true" />
              </Button>
            </li>)}</ul>}
            <p className="new-dialog-count" id={`${id}-limit`} aria-live="polite">Выбрано: {selected.length} из 9{selected.length === 9 ? ' · Достигнут лимит участников' : ' · До 10 участников вместе с вами'}</p>
            {selected.length > 1 && <div className="new-dialog-name"><label htmlFor={`${id}-name`}>Название группы <span>необязательно</span></label><Input id={`${id}-name`} maxLength={60} placeholder="Как назовём группу?" value={name} onChange={event => setName(event.target.value)} disabled={locked} /></div>}
            <div className="new-dialog-people" role="group" aria-label="Друзья и участники общих групп" aria-describedby={`${id}-limit`}>
              {visible.map(user => <SelectionRow key={user.id} user={user} checked={selected.includes(user.id)} disabled={locked || (selected.length >= 9 && !selected.includes(user.id))} friend={friendIds.has(user.id)} onChange={() => toggle(user.id)} />)}
              {!visible.length && <p className="new-dialog-empty">{search ? 'Никого не нашли. Попробуйте другое имя.' : 'Здесь появятся ваши друзья и участники общих групп.'}</p>}
            </div>
          </div>
          <footer className="new-dialog-footer">
            {error && <p className="new-dialog-error" role="alert">{created ? 'Чат создан, но не удалось обновить список. Повторите обновление. ' : ''}{error}</p>}
            <div className="new-dialog-actions">
              <RadixDialog.Close asChild><Button variant="outline" type="button" disabled={busy}>Отмена</Button></RadixDialog.Close>
              <Button type="submit" disabled={busy || selected.length === 0}>{busy && <LoaderCircle className="new-dialog-spinner" size={16} aria-hidden="true" />}{busy ? 'Создаём…' : created ? 'Повторить обновление' : error ? 'Попробовать снова' : selected.length > 1 ? 'Создать группу' : 'Создать чат'}</Button>
            </div>
          </footer>
        </form>
      </RadixDialog.Content>
    </RadixDialog.Portal>
  </RadixDialog.Root>;
}
