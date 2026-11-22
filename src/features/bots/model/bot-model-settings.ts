import {createStore} from 'zustand/vanilla';
import type {Bot, BotModelSettings, BotReasoning} from '@/shared/types';
import {modelDirty, modelInvalid, modelLoadError, modelSaveError, modelSettingsResponse} from './bot-settings-rules';
import {botService} from './services/bot-service';

export type BotModelSettingsState = {
 loaded: BotModelSettings | undefined;
 model: string;
 reasoning: BotReasoning;
 pending: boolean;
 error: string;
 notice: string;
};

const initialState: BotModelSettingsState = {
 loaded: undefined,
 model: '',
 reasoning: '',
 pending: false,
 error: '',
 notice: ''
};

export type ModelLoadArgs = {
 bot: Bot;
 keepDraft: boolean;
 nextRequest: () => number;
 isValid: (request: number) => boolean;
};

export type ModelContext = {
 bot: Bot;
 rootBusy: boolean;
 refresh: () => Promise<unknown>;
 nextRequest: () => number;
 isValid: (request: number) => boolean;
};

/** Хранилище вкладки «Модель»: каталог публикует провайдер, сервер хранит только выбор. */
export function createBotModelSettingsModel() {
 const store = createStore<BotModelSettingsState>(() => initialState);

 const load = async ({bot, keepDraft, nextRequest, isValid}: ModelLoadArgs) => {
  const request = nextRequest();
  store.setState({pending: true, error: ''});
  try {
   const next = modelSettingsResponse(await botService.modelSettings({bot: bot.id}));
   if (!isValid(request)) return;
   store.setState({loaded: next});
   if (!keepDraft) store.setState({model: next.model, reasoning: next.reasoning});
   else
    store.setState({
     notice:
      'Настройки изменились на сервере. Свежая версия загружена, ваш черновик сохранён. Проверьте его и сохраните снова.'
    });
  } catch (reason) {
   if (!isValid(request)) return;
   store.setState({error: modelLoadError(String(reason))});
  } finally {
   if (isValid(request)) store.setState({pending: false});
  }
 };

 const actions = {
  /** Правка черновика снимает прошлые сообщения: они относились к прежним значениям. */
  edit(patch: {model?: string; reasoning?: BotReasoning}) {
   const next: Partial<BotModelSettingsState> = {notice: '', error: ''};
   if (patch.model !== undefined) next.model = patch.model;
   if (patch.reasoning !== undefined) next.reasoning = patch.reasoning;
   store.setState(next);
  },
  load,

  /** Сохранение модели: конфликт перечитывает свежую версию, черновик остаётся у пользователя. */
  async save({bot, rootBusy, refresh, nextRequest, isValid}: ModelContext) {
   const {pending, loaded, model, reasoning} = store.getState();
   if (pending || rootBusy || !loaded || modelInvalid(model) || !modelDirty(loaded, model, reasoning)) return;
   const request = nextRequest();
   store.setState({pending: true, error: '', notice: ''});
   try {
    const next = modelSettingsResponse(
     await botService.updateModelSettings({
      bot: bot.id,
      model: model.trim(),
      reasoning,
      revision: loaded.revision
     })
    );
    if (!isValid(request)) return;
    store.setState({
     loaded: next,
     model: next.model,
     reasoning: next.reasoning,
     notice: 'Модель и уровень размышления сохранены. Значения применяет Hermes.'
    });
    void refresh().catch(() => {});
   } catch (reason) {
    if (!isValid(request)) return;
    const message = String(reason);
    if (message.includes('BOT_SETTINGS_CONFLICT')) {
     store.setState({
      notice: 'Настройки изменились на сервере. Загружаем свежую версию — проверьте значения и сохраните снова.'
     });
     await load({bot, keepDraft: true, nextRequest, isValid});
    } else store.setState({error: modelSaveError(message)});
   } finally {
    if (isValid(request)) store.setState({pending: false});
   }
  }
 };

 return {store, actions};
}
