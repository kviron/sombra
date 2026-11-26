import {getMessageAttachments} from '../../../shared/lib/message-attachments.ts';
import type {ChatMessage, MessageAttachmentMetadata} from '@/shared/types';
import {parseMessageLinks} from '../../../shared/lib/message-links.ts';
export type MaterialCategory = 'photos' | 'videos' | 'files' | 'audio' | 'links';
export type ConversationMaterial = {
 id: string;
 category: MaterialCategory;
 message: ChatMessage;
 attachment?: MessageAttachmentMetadata;
 title: string;
 href?: string;
};
export function attachmentCategory(name: string, mime: string): Exclude<MaterialCategory, 'links'> {
 const extension = name.split('.').at(-1)?.toLowerCase() || '';
 if (
  (mime.startsWith('image/') && !mime.includes('svg')) ||
  /^(png|jpe?g|webp|gif|avif|bmp|heic|heif|tiff?)$/.test(extension)
 )
  return 'photos';
 if (mime.startsWith('video/') || /^(mp4|webm|mov|mkv|avi|m4v)$/.test(extension)) return 'videos';
 if (mime.startsWith('audio/') || /^(mp3|ogg|opus|wav|m4a|aac|flac|aiff?)$/.test(extension)) return 'audio';
 return 'files';
}
/** Index only the active conversation. Never fetch URLs or attachment bodies here. */
export function conversationMaterials(messages: ChatMessage[], channel: string): ConversationMaterial[] {
 const result: ConversationMaterial[] = [];
 for (const message of messages) {
  if (message.channel !== channel) continue;
  for (const file of getMessageAttachments(message))
   result.push({
    id: `${message.id}:file:${file.id}`,
    category: attachmentCategory(file.name, file.mime),
    message,
    attachment: file,
    title: file.name
   });
  const links = new Set<string>();
  for (const part of parseMessageLinks(message.text)) {
   if (part.type !== 'link' || links.has(part.href)) continue;
   links.add(part.href);
   result.push({id: `${message.id}:${part.href}`, category: 'links', message, title: part.text, href: part.href});
  }
 }
 return result.sort((a, b) => b.message.time - a.message.time);
}
export function filterMaterials(
 items: ConversationMaterial[],
 category: MaterialCategory | 'all',
 query: string,
 userName: (id: string) => string
) {
 const needle = query.trim().toLocaleLowerCase('ru');
 return items.filter(
  item =>
   (category === 'all' || item.category === category) &&
   (!needle ||
    [item.title, item.href || '', item.message.text, userName(item.message.user)]
     .join(' ')
     .toLocaleLowerCase('ru')
     .includes(needle))
 );
}
