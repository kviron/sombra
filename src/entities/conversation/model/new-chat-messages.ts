import {albumSummary} from '../../../shared/lib/message-attachments.ts';
import type {ChatState} from '@/shared/types';

export type ChatNotificationPreferences = {
 notifications?: {direct?: boolean; groups?: boolean};
 dialogs?: Record<string, {pinned?: boolean; muted?: boolean}>;
};
type NotificationState = Pick<ChatState, 'me' | 'users' | 'dialogs' | 'groups' | 'messages'> & {
 chatPreferences?: ChatNotificationPreferences;
};
export type ChatNotification = {
 id: string;
 channel: string;
 sender: string;
 text: string;
 avatar?: string;
 count: number;
};
export type ChatNotificationCursor = {
 user: string;
 seen: Set<string>;
 channels: Set<string>;
 groups: Set<string>;
 polledAt: number;
};
export function createChatNotificationCursor(user: string): ChatNotificationCursor {
 return {user, seen: new Set(), channels: new Set(), groups: new Set(), polledAt: 0};
}
export function notificationEligible(
 channel: string,
 activeChannel: string | undefined,
 settingsOpen: boolean,
 visible: boolean,
 focused: boolean
) {
 return settingsOpen || channel !== activeChannel || !visible || !focused;
}
function preview(text: string) {
 const chars = Array.from(text);
 return chars.length > 220 ? chars.slice(0, 219).join('') + '…' : text;
}
/** Consumes every visible message before applying preferences. No storage writes or notification side effects.
 * Initial snapshots and newly joined groups are silent baselines. For a new DM or
 * a new channel inside a previously visible group,
 * only a reliable timestamp in/after the preceding poll's second can notify; absent/invalid
 * timestamps baseline silently. Server timestamps are seconds (millisecond inputs also work).
 * The one-second boundary deliberately accommodates the server's timestamp precision.
 */
export function newChatMessages(
 state: NotificationState,
 cursor: ChatNotificationCursor,
 now = Date.now()
): ChatNotification[] {
 if (cursor.user !== state.me.id) {
  cursor.user = state.me.id;
  cursor.seen.clear();
  cursor.channels.clear();
  cursor.groups.clear();
  cursor.polledAt = 0;
 }
 const initial = cursor.polledAt === 0;
 const channels = new Map<string, {group: boolean; groupID?: string; name: string}>();
 for (const dialog of state.dialogs)
  channels.set(dialog.id, {group: false, name: dialog.members.length > 2 ? dialog.name : ''});
 for (const group of state.groups)
  for (const channel of group.channels)
   channels.set(channel.id, {group: true, groupID: group.id, name: `${group.name} · #${channel.name}`});
 const users = new Map(state.users.map(user => [user.id, user]));
 const incoming: ChatNotification[] = [];
 for (const message of state.messages) {
  const context = channels.get(message.channel);
  if (!context || cursor.seen.has(message.id)) continue;
  cursor.seen.add(message.id);
  if (initial || message.user === state.me.id) continue;
  if (context.groupID && !cursor.groups.has(context.groupID)) continue;
  if (!cursor.channels.has(message.channel)) {
   const timestamp = message.time < 1e12 ? message.time * 1000 : message.time;
   if (
    !Number.isFinite(timestamp) ||
    timestamp <= 0 ||
    timestamp < Math.floor(cursor.polledAt / 1000) * 1000 ||
    timestamp > now + 60000
   )
    continue;
  }
  const preferences = state.chatPreferences;
  if (preferences?.dialogs?.[message.channel]?.muted) continue;
  if (context.group ? preferences?.notifications?.groups === false : preferences?.notifications?.direct === false)
   continue;
  const author = message.bot_name || users.get(message.user)?.name || 'Пользователь Sombra';
  const mentioned = message.mentions?.some(mention => mention.userId === state.me.id) === true;
  // Native toasts keep their strict fields; the explicit prefix is the only added signal.
  const sender = (mentioned ? 'Вас упомянули · ' : '') + (context.name ? `${context.name} · ${author}` : author);
  const text = preview(
   message.text.trim() ||
    albumSummary(message) ||
    (message.attachment ? `Файл: ${message.attachment.name}` : message.sticker ? 'Стикер' : 'Новое сообщение')
  );
  incoming.push({
   id: message.id,
   channel: message.channel,
   sender,
   text,
   avatar: users.get(message.user)?.avatar,
   count: 1
  });
 }
 cursor.channels = new Set(channels.keys());
 cursor.groups = new Set(state.groups.map(group => group.id));
 cursor.polledAt = now;
 return incoming;
}
/** Latest preview per chat, capped only after all messages have been consumed. */
export function batchChatNotifications(messages: ChatNotification[], limit = 5): ChatNotification[] {
 const chats = new Map<string, ChatNotification>();
 for (const message of messages) {
  const count = (chats.get(message.channel)?.count || 0) + message.count;
  chats.delete(message.channel);
  chats.set(message.channel, {...message, count});
 }
 return [...chats.values()].slice(-limit).map(message => ({
  ...message,
  sender: message.count > 1 ? `${message.sender} (${message.count} новых сообщений)` : message.sender
 }));
}
