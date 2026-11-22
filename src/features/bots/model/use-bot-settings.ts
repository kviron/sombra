import {useEffect, useRef, useState} from 'react';
import {useStore} from 'zustand';
import type {Bot, ChatState} from '@/shared/types';
import {createBotSettingsModel} from './bot-settings';
import {
 draftConversation,
 invalidAliases,
 managementSupported,
 parseAliases,
 settingsDirty,
 settingsInvalid
} from './bot-settings-rules';

type Options = {bot: Bot; state: ChatState; refresh: () => Promise<unknown>; onClose: () => void};

/**
 * Единственное место логики настроек бота: загрузка, черновик и сохранение.
 * Компонент получает готовые значения и колбэки.
 */
export function useBotSettings({bot, state, refresh, onClose}: Options) {
 const [model] = useState(createBotSettingsModel);
 const form = useStore(model.store);
 const alive = useRef(true);
 const epoch = useRef(0);
 const live = useRef({id: bot.id, owner: bot.owner, actor: state.me.id});
 live.current = {id: bot.id, owner: bot.owner, actor: state.me.id};
 const supported = managementSupported(bot);
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
 const context = {bot, owner: state.me.id, supported, refresh, onClose, nextRequest, isValid};

 useEffect(() => {
  alive.current = true;
  if (supported) void model.actions.load({bot, owner: state.me.id, keep: false, nextRequest, isValid});
  const invalidate = () => {
   alive.current = false;
   ++epoch.current;
   onClose();
  };
  window.addEventListener('authchange', invalidate);
  return () => {
   alive.current = false;
   ++epoch.current;
   window.removeEventListener('authchange', invalidate);
  };
 }, []); // identity is keyed by the parent

 const aliases = parseAliases(form.aliases);
 const conversation = draftConversation(form.conversation, form.aliases);
 const currentUserEntry = state.users.find(user => user.id === bot.id);

 return {
  tab: form.tab,
  loaded: form.loaded,
  name: form.name,
  bio: form.bio,
  avatar: form.avatar,
  conversation: form.conversation,
  aliases: form.aliases,
  busy: form.busy,
  error: form.error,
  notice: form.notice,
  crop: form.crop,
  supported,
  dirty: settingsDirty(form.loaded, {
   name: form.name,
   bio: form.bio,
   avatar: form.avatar,
   conversation
  }),
  invalid: settingsInvalid(form.name, form.bio, aliases, conversation),
  invalidAliases: invalidAliases(aliases),
  disabled: form.busy || !form.loaded || !supported,
  // Предпросмотр аватара: черновик важнее загруженного профиля и записи в списке пользователей.
  preview: {
   id: bot.id,
   name: form.name || currentUserEntry?.name || bot.name,
   avatar: form.avatar === undefined ? (form.loaded?.profile.avatar ?? currentUserEntry?.avatar) : form.avatar
  },
  actions: {
   setTab: model.actions.setTab,
   setName: model.actions.setName,
   setBio: model.actions.setBio,
   setAliases: model.actions.setAliases,
   setAvatar: model.actions.setAvatar,
   setCrop: model.actions.setCrop,
   setError: model.actions.setError,
   updateConversation: model.actions.updateConversation,
   save: () => void model.actions.save(context),
   retry: () => void model.actions.load({bot, owner: state.me.id, keep: false, nextRequest, isValid})
  }
 };
}

export type BotSettingsModel = ReturnType<typeof useBotSettings>;
