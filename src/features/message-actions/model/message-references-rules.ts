// Чистые правила ссылок на сообщения: краткое описание и поиск назначения пересылки.
// Сеть, DOM и React здесь не нужны, поэтому правила проверяются тестами.
import type {ChatMessage} from '@/shared/types';

export type ForwardDestination = {
 id: string;
 name: string;
 group?: {id: string; name: string};
 voice?: boolean;
 keywords?: string;
};

/** Короткое описание сообщения: текст, вложение, стикер или GIF. */
export function messagePreview(message: ChatMessage) {
 return (
  message.text?.trim() || message.attachment?.name || (message.sticker ? 'Стикер' : message.gif ? 'GIF' : 'Сообщение')
 );
}

export function matchesDestination(item: ForwardDestination, query: string) {
 return `${item.name} ${item.group?.name || ''} ${item.keywords || ''}`
  .toLocaleLowerCase()
  .includes(query.trim().toLocaleLowerCase());
}

export function filterDestinations(destinations: ForwardDestination[], query: string) {
 return destinations.filter(item => matchesDestination(item, query));
}

/** Что показать вместо пустого списка назначений. */
export function emptyDestinationsText(query: string) {
 return query.trim() ? 'Чаты и каналы не найдены.' : 'Нет доступных чатов и каналов.';
}
