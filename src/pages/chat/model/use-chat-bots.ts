import {useState} from 'react';
import {useStore} from 'zustand';
import type {Bot, ChatState} from '@/shared/types';
import {createChatBotsModel} from './chat-bots';
import {botRow, createBotDisabled, managedBotOf, visibleBots} from './chat-bots-rules';

type Options = {
 state: ChatState;
 refresh: () => Promise<unknown>;
 onError: (message: string) => void;
 channel: string;
 group?: string;
 owner: boolean;
};

/**
 * Окно «Подключения»: список ботов чата, права владельца, новый ключ и открытые настройки.
 * Компонент только показывает строки и передаёт клики в модель.
 */
export function useChatBots({state, refresh, onError, channel, group, owner}: Options) {
 const [model] = useState(createChatBotsModel);
 const {name, username, token, busy, copied, managementId} = useStore(model.store);
 const now = Date.now() / 1000;

 return {
  rows: visibleBots(state, channel, group).map(bot => botRow({state, bot, owner, now})),
  managed: managedBotOf(state, managementId),
  name,
  username,
  token,
  busy,
  copied,
  owner,
  createDisabled: createBotDisabled({busy, name, group, username}),
  actions: {
   setName: model.actions.setName,
   setUsername: model.actions.setUsername,
   dismissToken: model.actions.dismissToken,
   openManagement: model.actions.openManagement,
   closeManagement: model.actions.closeManagement,
   create: () => void model.actions.create({channel, group, refresh, onError}),
   rotate: (bot: Bot) => void model.actions.rotate({bot, refresh, onError}),
   remove: (bot: Bot) => void model.actions.remove({bot, group, refresh, onError}),
   copyToken: () => void model.actions.copyToken({onError})
  }
 };
}
