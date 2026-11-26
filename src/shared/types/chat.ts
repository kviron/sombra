import type {Bot} from './bot';
import type {Channel, Group} from './group';
import type {User} from './user';
import type {VoicePresence} from './voice';

export type DialogPreferences = {pinned: boolean; muted: boolean};
export type ChatPreferences = {
 revision?: number;
 notifications: {direct: boolean; groups: boolean};
 dialogs: Record<string, DialogPreferences>;
};
export type Dialog = {
 id: string;
 name: string;
 members: string[];
 owner?: string;
 avatar?: string;
 revision?: number;
 unreadCount?: number;
 unreadMentionCount?: number;
};
export type DialogCall = {
 id: string;
 dialog: string;
 caller: string;
 video: boolean;
 created_at: number;
 participants: string[];
 declined: string[];
 empty_since?: number;
};
export type AttachmentDraft = {name: string; data: string; mime?: string};
export type MessageAttachmentMetadata = {
 id: string;
 name: string;
 size: number;
 mime: string;
 width?: number;
 height?: number;
 expired?: boolean;
 cached?: boolean;
};
export type AttachmentFile = {data: string; mime: string; name: string; cached?: boolean};
export type MessageReply = {id: string; author?: string; text?: string};
export type ChatMessage = {
 replyTo?: MessageReply;
 forwardedFrom?: {author: string};
 gif?: string;
 mentions?: {userId: string; start: number; end: number}[];
 readCount?: number;
 readAt?: number;
 id: string;
 channel: string;
 user: string;
 text: string;
 time: number;
 sticker?: string;
 attachment?: MessageAttachmentMetadata;
 attachments?: MessageAttachmentMetadata[];
 bot_name?: string;
 reactions?: {user: string; emoji: string}[];
};
export type Sticker = {
 id: string;
 owner: string;
 name: string;
 image?: string;
 group?: string;
 pack?: string;
 archived?: boolean;
 keywords?: string[];
 packId?: string;
 packPublic?: boolean;
 packInstalled?: boolean;
 packAdded?: boolean;
};
export type StickerImageResponse = {image: string};
export type Friend = {id: string; from: string; to: string; accepted: boolean};
/** Страница истории канала: сервер отдаёт её от старых к новым. */
export type MessagesPage = {messages: ChatMessage[]; hasMore: boolean; nextBefore: string | null};

export type ChatState = {
 features?: {
  messageReferences?: boolean;
  stickerThumbnails?: boolean;
  attachmentMetadata?: boolean;
  messageAttachments?: boolean;
  /** Snapshot carries avatar hashes instead of inline pictures. */ avatarAssets?: boolean;
 };
 profileEffectUploadsSupported?: boolean;
 stickerCatalogSupported?: boolean;
 effectCatalogSupported?: boolean;
 profileEffectDraftsSupported?: boolean;
 decorationSupported?: boolean;
 conversationMemberSearchSupported?: boolean;
 dialogMetadataSupported?: boolean;
 humanTypingSupported?: boolean;
 humanTyping?: {user: string; channel: string; until: number}[];
 readReceiptsSupported?: boolean;
 botTyping?: {bot: string; channel: string; until: number}[];
 chatPreferences?: ChatPreferences;
 me: User;
 email: string;
 users: User[];
 groups: Group[];
 dialogs: Dialog[];
 /** Только последние сообщения каждого канала: остальное — страницами. */
 messages: ChatMessage[];
 /** Каналы, у которых история длиннее снапшота. */
 historyTruncated?: string[];
 stickers: Sticker[];
 friends: Friend[];
 bots: Bot[];
 voicePresence?: Record<string, VoicePresence[]>;
 dialogCalls?: DialogCall[];
};

export type {Channel, Group, User, VoicePresence, Bot};
