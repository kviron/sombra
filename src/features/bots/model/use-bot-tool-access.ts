import {useEffect, useRef, useState} from 'react';
import {useStore} from 'zustand';
import type {Bot, ChatState} from '@/shared/types';
import {createBotToolAccessModel} from './bot-tool-access';
import {
 canManageToolAccess,
 toolAccessCandidates,
 toolAccessDirty,
 toolAccessDisabled,
 toolAccessHumans,
 toolAccessOwner,
 toolAccessSupported,
 toolAccessWithinLimit,
 toolInvalidSelection
} from './bot-tool-access-rules';

type Options = {bot: Bot; state: ChatState; rootBusy: boolean};

/**
 * Панель «Доступ к инструментам»: раскрытие живёт в модели экземпляра, а React-связка
 * только создаёт её и закрывает при смене бота, владельца или аккаунта.
 */
export function useBotToolAccess({bot, state}: Options) {
 const [model] = useState(createBotToolAccessModel);
 const form = useStore(model.store);
 const {collapse} = model.actions;
 const managed = canManageToolAccess(state, bot);
 const identity = `${state.me.id}:${bot.id}:${bot.owner}:${managed}`;

 // Другой бот, владелец или аккаунт — панель закрывается: чужая политика не должна остаться открытой.
 useEffect(() => {
  collapse();
 }, [identity, collapse]);

 return {
  model,
  managed,
  expanded: form.expanded,
  actions: {toggle: model.actions.toggle}
 };
}

type PolicyOptions = Options & {model: ReturnType<typeof createBotToolAccessModel>};

/**
 * Содержимое раскрытой панели: загрузка политики, поиск людей, черновик и сохранение.
 * Компонент получает готовые значения и колбэки.
 */
export function useBotToolPolicy({model, bot, state, rootBusy}: PolicyOptions) {
 const form = useStore(model.store);
 const alive = useRef(true);
 const epoch = useRef(0);
 const live = useRef({bot: bot.id, owner: bot.owner, account: state.me.id});
 live.current = {bot: bot.id, owner: bot.owner, account: state.me.id};
 const supported = toolAccessSupported(bot);
 const isValid = (request: number) => {
  const current = live.current;
  return (
   alive.current &&
   epoch.current === request &&
   current.bot === bot.id &&
   current.owner === bot.owner &&
   current.account === state.me.id &&
   current.owner === current.account
  );
 };
 const nextRequest = () => ++epoch.current;

 useEffect(() => {
  alive.current = true;
  if (supported) void model.actions.load({bot, keep: false, nextRequest, isValid});
  const invalidate = () => {
   alive.current = false;
   nextRequest();
   model.actions.invalidate();
  };
  window.addEventListener('authchange', invalidate);
  return () => {
   alive.current = false;
   nextRequest();
   window.removeEventListener('authchange', invalidate);
  };
  // Экземпляр ключуется родителем: смена бота монтирует свежую панель.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [model]);

 const humans = toolAccessHumans(state, bot);
 const missing = toolInvalidSelection(form.draft, humans);
 const dirty = toolAccessDirty(form.policy, form.draft);
 const disabled = toolAccessDisabled({
  pending: form.pending,
  rootBusy,
  blocked: form.blocked,
  policy: form.policy
 });

 return {
  policy: form.policy,
  draft: form.draft,
  query: form.query,
  pending: form.pending,
  notice: form.notice,
  error: form.error,
  blocked: form.blocked,
  supported,
  owner: toolAccessOwner(state, bot),
  users: toolAccessCandidates(state, bot, form.query),
  missing,
  dirty,
  disabled,
  canSave: !disabled && dirty && !missing.length && toolAccessWithinLimit(form.draft),
  actions: {
   setQuery: model.actions.setQuery,
   select: (id: string, checked: boolean) => model.actions.select({rootBusy, id, checked}),
   save: () => void model.actions.save({bot, state, rootBusy, nextRequest, isValid}),
   retry: () => void model.actions.load({bot, keep: false, nextRequest, isValid})
  }
 };
}
