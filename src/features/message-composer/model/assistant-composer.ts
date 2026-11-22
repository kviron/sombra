// Данные UI-рантайма помощника: сообщений в нём нет — Sombra владеет черновиком и отправкой.
import type {ThreadMessage} from '@assistant-ui/react';
import {filterSuggestions, type ComposerSuggestion} from './assistant-composer-rules';

/** Root перехватывает отправку, поэтому рантайм только держит текст поля. */
export const threadMessages: ThreadMessage[] = [];

export const formatter = {
 serialize: (item: {metadata?: Readonly<Record<string, unknown>>}) => String(item.metadata?.insert || ''),
 parse: (text: string) => [{kind: 'text' as const, text}]
};

/** Адаптер подсказок: категории не нужны, поиск общий для упоминаний и команд. */
export function suggestionAdapter(items: ComposerSuggestion[], enabled: boolean) {
 return {
  categories: () => [],
  categoryItems: () => items,
  search: (query: string) => filterSuggestions(items, query, enabled)
 };
}
