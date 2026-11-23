// Чистые правила настроек уведомлений: без сети и без DOM, поэтому проверяются тестами.
import type {ChatPreferences} from '@/shared/types';

export type NotificationKey = 'direct' | 'groups';

/** По умолчанию уведомления включены: старые настройки сервера могут не содержать категорию. */
export function notificationsEnabled(preferences: ChatPreferences | undefined, key: NotificationKey): boolean {
 return preferences?.notifications[key] !== false;
}

/** Пока настройки не загружены или идёт сохранение, переключатель недоступен. */
export function notificationDisabled(ready: boolean, busy: boolean): boolean {
 return !ready || busy;
}

/** Меняется ровно одна категория: остальные настройки аккаунта не перезаписываются. */
export function notificationPayload(key: NotificationKey, enabled: boolean): Partial<Record<NotificationKey, boolean>> {
 return {[key]: enabled};
}

/** Текст ошибки сохранения: сообщение сервера важнее общей подписи. */
export function notificationError(reason: unknown): string {
 return reason instanceof Error ? reason.message : 'Не удалось сохранить настройки уведомлений.';
}
