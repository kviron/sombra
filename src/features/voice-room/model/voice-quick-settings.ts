// Состояние поповера быстрых настроек голоса: открыт он или закрыт.
import {createStore} from 'zustand/vanilla';

export type VoiceQuickSettingsState = {open: boolean};

/**
 * Хранилище создаётся на каждый экземпляр: у микрофона и наушников в одном окне
 * собственные поповеры, и общий модульный флаг открывал бы их одновременно.
 */
export function createVoiceQuickSettingsModel() {
 const store = createStore<VoiceQuickSettingsState>(() => ({open: false}));

 const actions = {
  setOpen(open: boolean) {
   store.setState({open});
  },
  /** Переход в общие настройки закрывает поповер: два окна поверх друг друга не нужны. */
  openSettings(onSettings: () => void) {
   store.setState({open: false});
   onSettings();
  }
 };

 return {store, actions};
}

export type VoiceQuickSettingsModel = ReturnType<typeof createVoiceQuickSettingsModel>;
