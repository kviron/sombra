// Состояние настроек уведомлений: одна операция сохранения на открытый раздел.
import {createStore} from 'zustand/vanilla';
import type {ChatPreferences} from '@/shared/types';
import {accountService} from '@/entities/account';
import {notificationError, notificationPayload, type NotificationKey} from './notification-settings-rules';

export type NotificationSettingsState = {busy: boolean; error: string};

export type ChangeArgs = {
 key: NotificationKey;
 enabled: boolean;
 ready: boolean;
 onSaved: (preferences: ChatPreferences) => void;
 isAlive: () => boolean;
};

/**
 * Хранилище создаётся на открытый раздел: закрытие настроек выбрасывает незавершённую
 * операцию, а не переносит её в следующее открытие.
 */
export function createNotificationSettingsModel() {
 const store = createStore<NotificationSettingsState>(() => ({busy: false, error: ''}));

 const actions = {
  /** Сохранение живёт в модели: готовность настроек, защита от двойного клика и ошибки — правило раздела. */
  async change({key, enabled, ready, onSaved, isAlive}: ChangeArgs) {
   if (store.getState().busy || !ready) return;
   store.setState({busy: true, error: ''});
   try {
    const preferences = await accountService.setNotificationPreferences<ChatPreferences>(
     notificationPayload(key, enabled)
    );
    if (isAlive()) onSaved(preferences);
   } catch (reason) {
    if (isAlive()) store.setState({error: notificationError(reason)});
   } finally {
    if (isAlive()) store.setState({busy: false});
   }
  }
 };

 return {store, actions};
}

export type NotificationSettingsModel = ReturnType<typeof createNotificationSettingsModel>;
