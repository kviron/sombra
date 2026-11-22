import {useCallback, useEffect, useRef, useState} from 'react';
import {useStore} from 'zustand';
import type {ChatPreferences} from '@/shared/types';
import {createNotificationSettingsModel} from './notification-settings';
import {notificationDisabled, notificationsEnabled, type NotificationKey} from './notification-settings-rules';

type Options = {
 preferences?: ChatPreferences;
 ready: boolean;
 onSaved: (preferences: ChatPreferences) => void;
};

/**
 * Единственное место, где живёт логика уведомлений: сохранение категории и его статус.
 * Компонент получает готовые данные и колбэки.
 */
export function useNotificationSettings({preferences, ready, onSaved}: Options) {
 const [model] = useState(() => createNotificationSettingsModel());
 const {busy, error} = useStore(model.store);
 const alive = useRef(true);

 useEffect(() => {
  alive.current = true;
  return () => {
   alive.current = false;
  };
 }, []);

 const change = useCallback(
  (key: NotificationKey, enabled: boolean) =>
   void model.actions.change({key, enabled, ready, onSaved, isAlive: () => alive.current}),
  [model, onSaved, ready]
 );

 return {
  busy,
  error,
  disabled: notificationDisabled(ready, busy),
  checked: (key: NotificationKey) => notificationsEnabled(preferences, key),
  change
 };
}

export type NotificationSettingsViewModel = ReturnType<typeof useNotificationSettings>;
