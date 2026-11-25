import {useRef, useState} from 'react';
import {Dialog} from 'radix-ui';
import {Volume2, X} from 'lucide-react';
import {UserRow} from '@/entities/user';
import {Button} from '@/shared/ui/button';
import {Input} from '@/shared/ui/input';
import type {Channel, Group, User} from '@/shared/types';
import {sendVoiceInvitation} from '../model/services/voice-invitation-service';

export function VoiceInviteDialog({
 group,
 channel,
 users,
 ownId,
 onClose,
 onRestoreFocus
}: {
 group: Group;
 channel: Channel;
 users: User[];
 ownId: string;
 onClose: () => void;
 onRestoreFocus: () => void;
}) {
 const [query, setQuery] = useState('');
 const [sent, setSent] = useState<string[]>([]);
 const [pending, setPending] = useState('');
 const [error, setError] = useState('');
 const [notice, setNotice] = useState('');
 const sending = useRef(false);
 const searchField = useRef<HTMLInputElement>(null);
 const search = query.trim().toLocaleLowerCase('ru');
 const visible = users
  .filter(user => user.id !== ownId && !user.bot && group.members.includes(user.id))
  .filter(user => [user.name, user.username ?? ''].some(value => value.toLocaleLowerCase('ru').includes(search)))
  .sort((a, b) => a.name.localeCompare(b.name, 'ru'));

 async function invite(user: User) {
  if (sending.current || sent.includes(user.id)) return;
  sending.current = true;
  setPending(user.id);
  setError('');
  setNotice('');
  try {
   await sendVoiceInvitation(group.id, channel.id, user.id);
   setSent(previous => [...previous, user.id]);
   setNotice(`Приглашение для ${user.name} отправлено.`);
  } catch {
   setError(`Не удалось отправить приглашение для ${user.name}. Попробуйте ещё раз.`);
  } finally {
   sending.current = false;
   setPending('');
  }
 }

 return (
  <Dialog.Root open onOpenChange={open => !open && onClose()}>
   <Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
    <Dialog.Content
     className="bg-background fixed top-1/2 left-1/2 z-50 grid max-h-[85vh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 overflow-auto rounded-xl border p-5 shadow-lg outline-none"
     onCloseAutoFocus={event => {
      event.preventDefault();
      onRestoreFocus();
     }}
     onOpenAutoFocus={event => {
      event.preventDefault();
      searchField.current?.focus();
     }}
    >
     <div className="grid gap-1.5 pr-8">
      <Dialog.Title className="text-lg font-semibold">Пригласить в голосовой канал</Dialog.Title>
      <Dialog.Description className="text-muted-foreground flex items-center gap-2 text-sm">
       <Volume2 aria-hidden="true" className="size-4 shrink-0" />
       <span className="truncate">
        {group.name} / {channel.name}
       </span>
      </Dialog.Description>
      <p className="text-muted-foreground text-sm">Участникам группы придёт сообщение в личку.</p>
     </div>
     <Dialog.Close asChild>
      <Button variant="ghost" size="icon-sm" className="absolute top-4 right-4" aria-label="Закрыть приглашение">
       <X />
      </Button>
     </Dialog.Close>
     <Input
      ref={searchField}
      type="search"
      aria-label="Поиск участников группы"
      placeholder="Имя или логин"
      value={query}
      onChange={event => setQuery(event.target.value)}
     />
     <p className="sr-only" role="status">
      {notice}
     </p>
     {error && (
      <p className="text-destructive text-sm" role="alert">
       {error}
      </p>
     )}
     {visible.length ? (
      <ul className="grid max-h-72 gap-1 overflow-y-auto" aria-label="Участники группы">
       {visible.map(user => (
        <li key={user.id} className="flex min-w-0 items-center justify-between gap-2">
         <UserRow identity={user} subtitle={user.username ? `@${user.username}` : undefined} menu={false} />
         <Button
          type="button"
          variant="outline"
          size="sm"
          aria-disabled={!!pending || sent.includes(user.id)}
          aria-label={sent.includes(user.id) ? `Приглашение для ${user.name} отправлено` : `Пригласить ${user.name}`}
          onClick={() => void invite(user)}
         >
          {sent.includes(user.id) ? 'Отправлено' : pending === user.id ? 'Отправка…' : 'Пригласить'}
         </Button>
        </li>
       ))}
      </ul>
     ) : (
      <p className="text-muted-foreground text-sm">
       {search ? 'Никого не нашли.' : 'В группе пока некого пригласить.'}
      </p>
     )}
    </Dialog.Content>
   </Dialog.Portal>
  </Dialog.Root>
 );
}
