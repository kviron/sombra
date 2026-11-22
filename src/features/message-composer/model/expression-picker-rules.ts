// Чистые правила панели эмодзи и стикеров: категории, поиск, наборы и права.
// Файл намеренно не импортирует ничего, кроме типов: так его читает node --experimental-strip-types.
import type {Sticker} from '@/shared/types';

export type ExpressionPanel = 'emoji' | 'stickers';
export type StickerScope = 'personal' | 'group';
export type EmojiEntry = {name: string; keywords?: string[]; skins: {native: string}[]};

export const emojiCategoryLabels: Record<string, string> = {
 people: 'Люди',
 nature: 'Природа',
 foods: 'Еда',
 activity: 'Занятия',
 places: 'Места',
 objects: 'Предметы',
 symbols: 'Символы',
 flags: 'Флаги'
};

export const emojiCategoryOptions = (categories: readonly {id: string}[]) =>
 categories.map(item => ({value: item.id, label: emojiCategoryLabels[item.id] || item.id}));

/** Совпадение ищем по имени, ключевым словам и самому эмодзи. */
function matchesEmoji(item: EmojiEntry, id: string, search: string) {
 return [item.name, id, ...(item.keywords || []), item.skins[0]?.native].some(value =>
  value?.toLowerCase().includes(search)
 );
}

type EmojiArgs = {
 emojis: Record<string, EmojiEntry>;
 categories: readonly {id: string; emojis: string[]}[];
 category: string;
 query: string;
};

/** Без запроса — эмодзи выбранной категории, с запросом — поиск по всей библиотеке. */
export function visibleEmojiIds({emojis, categories, category, query}: EmojiArgs) {
 const search = query.trim().toLowerCase();
 if (!search) return categories.find(item => item.id === category)?.emojis || [];
 return Object.keys(emojis).filter(id => matchesEmoji(emojis[id], id, search));
}

/** Наборы в порядке первого стикера; пустой ключ — «Все наборы». */
export function stickerPackOptions(packs: ReadonlyMap<string, string>) {
 return [
  {value: '', label: 'Все наборы'},
  ...[...packs].filter(([key]) => key).map(([value, label]) => ({value, label}))
 ];
}

/** Выбранный набор мог исчезнуть: тогда показываем всю библиотеку. */
export const resolvePack = (packs: ReadonlyMap<string, string>, pack: string) => (packs.has(pack) ? pack : '');

export function visibleStickers(
 library: readonly Sticker[],
 activePack: string,
 packKey: (sticker: Sticker) => string
) {
 return library.filter(sticker => !activePack || packKey(sticker) === activePack);
}

/** Личными стикерами управляет каждый, групповыми — только с правом группы. */
export const canManageStickers = (scope: StickerScope, allowed: boolean) => scope === 'personal' || allowed;
