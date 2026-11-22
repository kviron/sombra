// Чистые правила доступа к инструментам бота: права, ответ сервера и черновик выбора.
// Файл импортирует только типы: так его читает node --experimental-strip-types.
import type {Bot, ChatState, User} from '@/shared/types';

/** Предел сервера: больше 50 доверенных пользователей политика не принимает. */
export const toolUsersLimit = 50;

export type ToolPolicy = {revision: number; owner: string; users: string[]};

export const toolUpgradeNote = 'Для настройки инструментов обновите сервер/подключение бота';
export const toolLimitNotice = 'Можно выбрать не более 50 пользователей.';
export const toolOwnerChangedOnLoad = 'Владелец бота изменился. Закройте настройки и обновите список ботов.';
export const toolOwnerChangedOnSave = 'Владелец бота изменился. Обновите список ботов.';
export const toolReloadedNotice =
 'Настройки изменились на сервере. Свежая версия загружена; ваш выбор сохранён как черновик. Проверьте его и снова нажмите «Сохранить».';
export const toolSavedNotice = 'Доступ сохранён. Сам по себе этот список не включает инструменты.';
export const toolConflictNotice = 'Конфликт изменений. Ваш черновик сохранён; загружаем свежую политику.';
export const toolLoadFailed = 'Не удалось загрузить доступ.';
export const toolSaveFailed = 'Не удалось сохранить доступ.';
export const toolAccountChanged = 'Аккаунт изменился. Откройте настройки заново.';
export const toolResponseInvalid = 'Некорректный ответ настроек доступа.';

/** Правило продукта: политика доступна владельцу бота, но не самому боту. */
export function canManageToolAccess(state: ChatState, bot: Bot) {
 return !state.me.bot && bot.owner === state.me.id;
}

/** Политика существует на сервере с транспортом версии 2 и только у бота без привязки к каналу. */
export function toolAccessSupported(bot: Bot) {
 return !!bot.transportVersion && bot.transportVersion >= 2 && !bot.channel;
}

/** Один и тот же порядок у черновика и у сервера: иначе «изменено» врёт. */
export const normalizedUsers = (users: readonly string[]) => [...new Set(users)].sort();

/** Ответ сервера проверяется до применения: кривая ревизия и чужие ID в политику не попадают. */
export function toolPolicyResponse(value: unknown): ToolPolicy {
 const policy = value as ToolPolicy;
 if (
  !policy ||
  !Number.isSafeInteger(policy.revision) ||
  policy.revision < 0 ||
  typeof policy.owner !== 'string' ||
  !Array.isArray(policy.users) ||
  policy.users.length > toolUsersLimit ||
  policy.users.some(id => typeof id !== 'string')
 )
  throw new Error(toolResponseInvalid);
 return {...policy, users: normalizedUsers(policy.users.filter(id => id !== policy.owner))};
}

/** Кого вообще можно выбрать: люди Sombra, кроме владельца бота и самого бота. */
export function toolAccessHumans(state: ChatState, bot: Bot) {
 return state.users.filter(user => !user.bot && user.id !== bot.owner);
}

/** Владелец в строке всегда включён: его подпись показывает имя и неизменяемый ID. */
export function toolAccessOwner(state: ChatState, bot: Bot) {
 return state.users.find(user => user.id === bot.owner) || state.me;
}

/** Поиск по имени и неизменяемому ID: ID виден в строке, поэтому участвует в поиске. */
export function matchesToolUser(user: User, query: string) {
 return `${user.name} ${user.id}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
}

export function toolAccessCandidates(state: ChatState, bot: Bot, query: string) {
 return toolAccessHumans(state, bot).filter(user => matchesToolUser(user, query));
}

/** Выбранные ID, которых больше нет среди людей: их нужно убрать до сохранения. */
export function toolInvalidSelection(draft: readonly string[], humans: readonly {id: string}[]) {
 return draft.filter(id => !humans.some(user => user.id === id));
}

export function toolAccessDirty(policy: ToolPolicy | undefined, draft: readonly string[]) {
 return !!policy && JSON.stringify(normalizedUsers(draft)) !== JSON.stringify(policy.users);
}

/** Черновик в пределах серверного лимита: сверх него политика не сохраняется. */
export const toolAccessWithinLimit = (draft: readonly string[]) => draft.length <= toolUsersLimit;

/** Предел достигнут: новый пользователь не добавится, снять отметку с выбранного можно всегда. */
export function toolAccessFull(draft: readonly string[], id: string) {
 return !draft.includes(id) && draft.length >= toolUsersLimit;
}

export function toggleToolUser(draft: readonly string[], id: string, checked: boolean) {
 if (checked && toolAccessFull(draft, id)) return [...draft];
 return normalizedUsers(checked ? [...draft, id] : draft.filter(value => value !== id));
}

type DisabledArgs = {pending: boolean; rootBusy: boolean; blocked: boolean; policy: ToolPolicy | undefined};

/** Всё поле выбора неактивно: ожидание, занятость окна настроек, смена владельца или нет политики. */
export const toolAccessDisabled = ({pending, rootBusy, blocked, policy}: DisabledArgs) =>
 pending || rootBusy || blocked || !policy;

/** Конфликт ревизии приходит текстом: отдельного кода у сервера нет. */
export const isToolPolicyConflict = (message: string) => /conflict|revision|конфликт|верси[яию]|устарел/i.test(message);
