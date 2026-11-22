// Чистые правила окна «Подключения»: список ботов, права владельца и подписи строк.
// Файл импортирует только типы: так его читает node --experimental-strip-types.
import type {Bot, BotCommand, ChatState} from '@/shared/types';

export const botRotateConfirm = 'Заменить ключ? Старый ключ немедленно перестанет работать.';
export const botRemoveConfirm = 'Отключить бота от этого чата?';
export const botActionFailed = 'Не удалось обновить подключение бота. Попробуйте снова.';
export const botCopyFailed = 'Не удалось скопировать ключ. Проверьте доступ к буферу обмена.';

/** Сколько секунд молчания сервиса бота ещё считается подключением. */
export const SERVICE_LIVENESS_SECONDS = 120;

/** Идентичность для аватара: бот берётся из списка людей, иначе показывается по своему имени. */
export type BotIdentity = {id: string; name: string; avatar?: string; bot?: boolean; online?: boolean};

/**
 * «Подключения» в группе показывают ботов группы и ботов каналов этой комнаты;
 * вне группы — только ботов открытой комнаты.
 */
export function visibleBots(state: ChatState, channel: string, group: string | undefined) {
 return (state.bots || []).filter(bot =>
  group
   ? bot.groups
     ? bot.groups.includes(group) || bot.channel === channel
     : bot.group === group || bot.channel === channel
   : bot.channel === channel
 );
}

export function botIdentity(state: ChatState, bot: Bot): BotIdentity {
 return state.users.find(user => user.id === bot.id) || {id: bot.id, name: bot.name};
}

export function botStatusText(bot: Bot, nowSeconds: number) {
 if (bot.enabled === false) return 'Отключён';
 return bot.last_seen && nowSeconds - bot.last_seen < SERVICE_LIVENESS_SECONDS
  ? 'Сервис подключён'
  : 'Нет недавней активности сервиса';
}

/** Что бот читает: комната — только её историю, иначе режим приватности из настроек бота. */
export function botPrivacyText(bot: Bot) {
 if (bot.channel) return 'Доступ к истории этой комнаты';
 return bot.privacy === false || bot.privacy === 'all'
  ? 'Читает все сообщения разрешённых чатов'
  : 'Команды и упоминания; личные сообщения — в отдельном диалоге';
}

/** Настройки открывает владелец, если он не сам бот. */
export const canOpenBotSettings = (state: ChatState, bot: Bot) => !state.me.bot && bot.owner === state.me.id;

/** Ключ меняет владелец; в канале это делает ещё и тот, у кого есть право управлять ботами. */
export const canRotateBotToken = (state: ChatState, bot: Bot, owner: boolean) =>
 bot.owner === state.me.id && (!bot.channel || owner);

/** Отключать бота от чата можно только с правом управления ботами этого чата. */
export const canRemoveBot = (owner: boolean) => owner;

export function createBotDisabled({
 busy,
 name,
 group,
 username
}: {
 busy: boolean;
 name: string;
 group: string | undefined;
 username: string;
}) {
 return busy || !name.trim() || (!!group && !username.trim());
}

/** Тело запроса: в группе нужен уникальный логин, в комнате он не задаётся. */
export function createBotPayload({
 group,
 channel,
 name,
 username
}: {
 group: string | undefined;
 channel: string;
 name: string;
 username: string;
}) {
 return group ? {group, name: name.trim(), username: username.trim().replace(/^@/, '')} : {channel, name: name.trim()};
}

/** Какой бот открыт в настройках: только свой и только у не-бота. */
export function managedBotOf(state: ChatState, managementId: string) {
 return state.bots?.find(bot => bot.id === managementId && bot.owner === state.me.id);
}

/** Бот из группы отвязывается от группы, бот комнаты — от комнаты. */
export function removeBotPayload({bot, group}: {bot: Bot; group: string | undefined}) {
 return group && !bot.channel ? {bot: bot.id, group} : {bot: bot.id};
}

export type BotRow = {
 bot: Bot;
 user: BotIdentity;
 status: string;
 privacy: string;
 commands: BotCommand[];
 settings: boolean;
 token: boolean;
 remove: boolean;
};

/** Готовая строка разметки: тексты, команды и три права считаются здесь, а не в компоненте. */
export function botRow({state, bot, owner, now}: {state: ChatState; bot: Bot; owner: boolean; now: number}): BotRow {
 return {
  bot,
  user: botIdentity(state, bot),
  status: botStatusText(bot, now),
  privacy: botPrivacyText(bot),
  commands: bot.commands || [],
  settings: canOpenBotSettings(state, bot),
  token: canRotateBotToken(state, bot, owner),
  remove: canRemoveBot(owner)
 };
}
