// Чистые правила панели помощника: подсказки, вставка упоминаний и музыкальные команды.
// Файл намеренно не импортирует ничего, кроме типов: так его читает node --experimental-strip-types.

/** Подсказка поля ввода: участник, команда бота или музыкальная команда. */
export type ComposerSuggestion = {
 id: string;
 type: string;
 label: string;
 description: string;
 metadata: {insert: string; avatar: string; search: string};
};

/** Музыкальные команды вставляются без отправки, как и команды ботов. */
export const musicCommands: ComposerSuggestion[] = [
 ['play', 'Добавить трек · вставьте ссылку после команды'],
 ['pause', 'Поставить музыку на паузу'],
 ['resume', 'Продолжить воспроизведение'],
 ['skip', 'Пропустить трек'],
 ['stop', 'Остановить и очистить очередь']
].map(([name, description]) => ({
 id: `music:${name}`,
 type: 'command',
 label: `/${name}`,
 description,
 metadata: {insert: `/${name}`, avatar: '', search: name}
}));

/** Музыка звучит только в голосовом канале группы: личный диалог её не знает. */
export const roomMusicEnabled = (
 groups: readonly {id: string; channels: {id: string; kind: string}[]}[],
 group: string | undefined,
 channel: string
) => groups.some(item => item.id === group && item.channels.some(row => row.id === channel && row.kind === 'voice'));

export const musicCommandsFor = (roomMusic: boolean) => (roomMusic ? musicCommands : []);

/** Поиск подсказок по началу любого слова; отключённое поле не предлагает ничего. */
export function filterSuggestions(items: ComposerSuggestion[], query: string, enabled: boolean) {
 if (!enabled) return [];
 const needle = query.toLocaleLowerCase();
 return items
  .filter(item =>
   String(item.metadata.search)
    .toLocaleLowerCase()
    .split(' ')
    .some(part => part.startsWith(needle))
  )
  .slice(0, 12);
}

type EnterArgs = {
 roomMusic: boolean;
 enabled: boolean;
 key: string;
 shift: boolean;
 ctrl: boolean;
 alt: boolean;
 meta: boolean;
 composing: boolean;
 keyCode: number;
};

/** Enter отправляет музыкальную команду только в голосовой комнате и без модификаторов. */
export function musicEnterPressed({roomMusic, enabled, key, shift, ctrl, alt, meta, composing, keyCode}: EnterArgs) {
 return roomMusic && enabled && key === 'Enter' && !shift && !ctrl && !alt && !meta && !composing && keyCode !== 229;
}

/** Смещения упоминания действительны, только пока токен стоит на своём месте. */
export function insertedMention(offset: number, token: string, text: string) {
 return text.slice(offset, offset + token.length) === token ? {start: offset, end: offset + token.length} : undefined;
}

/** Локальная команда поиска убирает пробел, оставшийся после вставки. */
export const withoutLeadingSpace = (text: string) => (text.startsWith(' ') ? text.slice(1) : text);

export type LocalCommand = 'clear' | 'search';

export const localCommand = (id: string): LocalCommand | undefined =>
 id === 'local:clear' ? 'clear' : id === 'local:search' ? 'search' : undefined;
