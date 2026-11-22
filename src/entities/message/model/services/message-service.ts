import {api} from '@/shared/api';
import type {AttachmentFile, ChatMessage, MessagesPage} from '@/shared/types';

type MessageReader = {user: string; seenAt: number};

/** Сообщения: единственный вход к отправке, правке, пересылке и прочтению. */
export const messageService = {
 send: <T = ChatMessage>(payload: Record<string, unknown>) => api.message.send<T>(payload),
 update: (payload: Record<string, unknown>) => api.message.update(payload),
 remove: (payload: Record<string, unknown>) => api.message.remove(payload),
 forward: <T = {messages: ChatMessage[]}>(payload: Record<string, unknown>) => api.message.forward<T>(payload),
 react: (payload: Record<string, unknown>) => api.message.react(payload),
 readers: <T = {readers: MessageReader[]}>(payload: Record<string, unknown>) => api.message.readers<T>(payload),
 markRead: (payload: Record<string, unknown>) => api.message.markRead(payload),
 /** История канала страницами: `before` — id самого раннего загруженного сообщения. */
 page: (payload: {channel: string; before?: string; limit?: number}) => api.message.page<MessagesPage>(payload),
 attachment: <T = AttachmentFile>(payload: Record<string, unknown>) => api.message.attachment<T>(payload)
};
