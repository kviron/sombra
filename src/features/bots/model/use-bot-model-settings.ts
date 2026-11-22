import {useEffect, useRef, useState} from 'react';
import {useStore} from 'zustand';
import type {Bot, ChatState} from '@/shared/types';
import {createBotModelSettingsModel} from './bot-model-settings';
import {
 currentModelLabel,
 currentReasoningLabel,
 modelCatalog,
 modelDirty,
 modelInvalid,
 modelOptions
} from './bot-settings-rules';

type Options = {bot: Bot; state: ChatState; refresh: () => Promise<unknown>; rootBusy: boolean};

/** Вкладка «Модель»: загрузка, черновик и сохранение живут в модели, компонент только показывает. */
export function useBotModelSettings({bot, state, refresh, rootBusy}: Options) {
 const [model] = useState(createBotModelSettingsModel);
 const form = useStore(model.store);
 const alive = useRef(true);
 const epoch = useRef(0);
 const live = useRef({id: bot.id, owner: bot.owner, actor: state.me.id});
 live.current = {id: bot.id, owner: bot.owner, actor: state.me.id};
 const isValid = (request: number) => {
  const current = live.current;
  return (
   alive.current &&
   epoch.current === request &&
   current.id === bot.id &&
   current.owner === bot.owner &&
   current.actor === state.me.id &&
   current.owner === current.actor
  );
 };
 const nextRequest = () => ++epoch.current;
 const context = {bot, rootBusy, refresh, nextRequest, isValid};

 useEffect(() => {
  alive.current = true;
  void model.actions.load({bot, keepDraft: false, nextRequest, isValid});
  const invalidate = () => {
   alive.current = false;
   ++epoch.current;
  };
  window.addEventListener('authchange', invalidate);
  return () => {
   alive.current = false;
   ++epoch.current;
   window.removeEventListener('authchange', invalidate);
  };
 }, []); // identity is keyed by the parent

 const catalog = modelCatalog(bot);

 return {
  loaded: form.loaded,
  model: form.model,
  trimmed: form.model.trim(),
  reasoning: form.reasoning,
  pending: form.pending,
  error: form.error,
  notice: form.notice,
  catalog,
  invalidModel: modelInvalid(form.model),
  dirty: modelDirty(form.loaded, form.model, form.reasoning),
  disabled: form.pending || rootBusy || !form.loaded,
  modelOptions: modelOptions(catalog, form.loaded),
  currentModel: currentModelLabel(form.loaded),
  currentReasoning: currentReasoningLabel(form.loaded),
  actions: {
   edit: model.actions.edit,
   save: () => void model.actions.save(context),
   retry: () => void model.actions.load({bot, keepDraft: false, nextRequest, isValid})
  }
 };
}
