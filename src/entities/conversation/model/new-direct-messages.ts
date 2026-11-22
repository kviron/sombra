import type {ChatState} from '@/shared/types';

export function newDirectMessages(
 state: Pick<ChatState, 'me' | 'users' | 'dialogs' | 'messages'>,
 seen: Set<string>,
 initial = false
) {
 const dialogs = new Set(state.dialogs.map(dialog => dialog.id));
 const users = new Map(state.users.map(user => [user.id, user]));
 const incoming = [];
 for (const message of state.messages) {
  if (!dialogs.has(message.channel) || seen.has(message.id)) continue;
  seen.add(message.id);
  if (initial || message.user === state.me.id) continue;
  const user = users.get(message.user);
  const text =
   message.text.trim() ||
   (message.attachment ? `Файл: ${message.attachment.name}` : message.sticker ? 'Стикер' : 'Новое сообщение');
  const characters = [...text];
  incoming.push({
   id: message.id,
   sender: user?.name || 'Пользователь Sombra',
   avatar: user?.avatar,
   text: characters.length > 220 ? characters.slice(0, 219).join('') + '…' : text
  });
 }
 return incoming;
}
