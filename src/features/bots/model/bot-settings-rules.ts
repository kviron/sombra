// Чистые правила настроек бота: права, черновик, проверки и тексты ошибок.
import type {Bot, BotModelSettings, BotReasoning, ChatState} from '@/shared/types';

export type BotConversation = {
 mode: 'addressed' | 'name_dialog';
 aliases: string[];
 followupSeconds: number;
 followupMessages: number;
 reactions: boolean;
};

export type BotSettings = {
 bot: Bot;
 profile: {name: string; bio: string; avatar?: string};
 revision: number;
 conversation: BotConversation;
};

export type BotSettingsDraft = {
 name: string;
 bio: string;
 avatar: string | undefined;
 conversation: BotConversation | undefined;
};

export const botNameMaxLength = 32;
export const botBioMaxLength = 512;
export const maxAliases = 8;
export const followupSecondsMax = 600;
export const followupMessagesMax = 20;

const avatarTypes = ['image/png', 'image/jpeg', 'image/webp'];
const reasoningLabels: Record<Exclude<BotReasoning, ''>, 'низкий' | 'средний' | 'высокий'> = {
 low: 'низкий',
 medium: 'средний',
 high: 'высокий'
};

export const reasoningOptions = [
 {value: '', label: 'По умолчанию'},
 {value: 'low', label: 'Низкий'},
 {value: 'medium', label: 'Средний'},
 {value: 'high', label: 'Высокий'}
] as const;

export const modelIdentifier = /^[A-Za-z0-9\-_.:/@+]*$/;

/** Правило продукта: настройки бота доступны только владельцу и не самому боту. */
export function canManageBot(state: ChatState, bot: Bot) {
 return !state.me.bot && bot.owner === state.me.id;
}

export function managementSupported(bot: Bot) {
 return (bot.managementVersion || 0) >= 1 && !bot.channel;
}

export const avatarTypeAllowed = (type: string) => avatarTypes.includes(type);

/** Имена для обращения: через запятую или с новой строки, пустые отбрасываются. */
export const parseAliases = (text: string) =>
 text
  .split(/[,\n]/)
  .map(value => value.trim())
  .filter(Boolean);

export function invalidAliases(aliases: string[]) {
 return (
  aliases.length > maxAliases ||
  aliases.some(value => value.length < 2 || value.length > 32 || /^(all|everyone|here|все)$/i.test(value))
 );
}

export function draftConversation(conversation: BotConversation | undefined, aliases: string) {
 if (!conversation) return undefined;
 return {...conversation, aliases: parseAliases(aliases)};
}

/** Черновик отличается от загруженного: имя, описание, аватар или общение. */
export function settingsDirty(loaded: BotSettings | undefined, draft: BotSettingsDraft) {
 return (
  !!loaded &&
  (draft.name !== loaded.profile.name ||
   draft.bio !== loaded.profile.bio ||
   draft.avatar !== undefined ||
   JSON.stringify(draft.conversation) !== JSON.stringify(loaded.conversation))
 );
}

/** Проверки перед сохранением: длина имени и описания, имена и пределы продолжения. */
export function settingsInvalid(
 name: string,
 bio: string,
 aliases: string[],
 conversation: BotConversation | undefined
) {
 return (
  !name.trim() ||
  name.length > botNameMaxLength ||
  bio.length > botBioMaxLength ||
  invalidAliases(aliases) ||
  !conversation ||
  !Number.isInteger(conversation.followupSeconds) ||
  conversation.followupSeconds < 0 ||
  conversation.followupSeconds > followupSecondsMax ||
  !Number.isInteger(conversation.followupMessages) ||
  conversation.followupMessages < 0 ||
  conversation.followupMessages > followupMessagesMax
 );
}

/** Ответ сервера проверяется до применения: чужой бот и кривая ревизия не попадают в черновик. */
export function botSettingsResponse(value: BotSettings, bot: Bot, owner: string) {
 if (
  value.bot.id !== bot.id ||
  value.bot.owner !== owner ||
  !Number.isSafeInteger(value.revision) ||
  !value.profile ||
  !value.conversation
 )
  throw new Error('invalid');
 return value;
}

export function modelSettingsResponse(value: unknown): BotModelSettings {
 const settings = value as BotModelSettings | null;
 if (
  !settings ||
  typeof settings !== 'object' ||
  typeof settings.model !== 'string' ||
  settings.model.length > 120 ||
  !modelIdentifier.test(settings.model) ||
  typeof settings.reasoning !== 'string' ||
  !['', 'low', 'medium', 'high'].includes(settings.reasoning) ||
  !Number.isSafeInteger(settings.revision) ||
  settings.revision < 0 ||
  typeof settings.modelDefault !== 'boolean' ||
  typeof settings.reasoningDefault !== 'boolean'
 )
  throw new Error('Некорректный ответ настроек модели.');
 return settings;
}

/** Каталог моделей публикует провайдер; сервер его не хранит, поэтому список необязателен. */
export function modelCatalog(bot: Bot) {
 const models = bot.modelSettings?.models;
 if (!Array.isArray(models)) return [];
 return [
  ...new Set(
   models.filter(value => typeof value === 'string' && value.length <= 120 && !!value && modelIdentifier.test(value))
  )
 ].slice(0, 12);
}

export function modelInvalid(model: string) {
 const trimmed = model.trim();
 return trimmed.length > 120 || !modelIdentifier.test(trimmed);
}

export function modelDirty(loaded: BotModelSettings | undefined, model: string, reasoning: BotReasoning) {
 return !!loaded && (model.trim() !== loaded.model || reasoning !== loaded.reasoning);
}

export function modelOptions(catalog: string[], loaded: BotModelSettings | undefined) {
 return [...new Set(['', ...catalog, ...(loaded?.model ? [loaded.model] : [])])];
}

export const currentModelLabel = (loaded: BotModelSettings | undefined) =>
 loaded ? (loaded.modelDefault || !loaded.model ? 'модель по умолчанию' : loaded.model) : '';

export const currentReasoningLabel = (loaded: BotModelSettings | undefined) =>
 loaded
  ? loaded.reasoningDefault || !loaded.reasoning
    ? 'размышление по умолчанию'
    : (reasoningLabels[loaded.reasoning as Exclude<BotReasoning, ''>] ?? loaded.reasoning)
  : '';

/** Текст ошибки загрузки модели: запрет прав, неподдерживаемый сервер или общий сбой. */
export function modelLoadError(message: string) {
 return message.includes('BOT_SETTINGS_FORBIDDEN')
  ? 'Настройки модели доступны только владельцу действующего бота. Если владелец — вы, обновите сервер и подключение бота.'
  : /unknown|неизвестн|не поддерж/i.test(message)
    ? 'Сервер пока не поддерживает настройки модели. Обновите сервер и подключение бота.'
    : 'Не удалось загрузить настройки модели. Повторите загрузку.';
}

/** Текст ошибки сохранения модели: конфликт обрабатывается отдельно. */
export function modelSaveError(message: string) {
 if (message.includes('BOT_SETTINGS_FORBIDDEN'))
  return 'Менять модель и уровень размышления может только владелец действующего бота (не legacy и не отключённого). Если владелец — вы, обновите сервер и подключение бота.';
 if (message.includes('BOT_SETTINGS_INVALID'))
  return 'Сервер отклонил значения. Проверьте идентификатор модели: до 120 символов из A–Z, a–z, 0–9 и - _ . : / @ +; уровень размышления — только «по умолчанию», низкий, средний или высокий.';
 return 'Не удалось сохранить настройки модели: сервер не подтвердил изменения. Попробуйте снова.';
}
