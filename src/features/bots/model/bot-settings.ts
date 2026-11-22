import {createStore} from 'zustand/vanilla';
import type {Bot} from '@/shared/types';
import {
 type BotConversation,
 type BotSettings,
 botSettingsResponse,
 draftConversation,
 parseAliases,
 settingsDirty,
 settingsInvalid
} from './bot-settings-rules';
import {botService} from './services/bot-service';

export type BotSettingsState = {
 tab: string;
 loaded: BotSettings | undefined;
 name: string;
 bio: string;
 avatar: string | undefined;
 conversation: BotConversation | undefined;
 aliases: string;
 busy: boolean;
 error: string;
 notice: string;
 crop: File | undefined;
};

const initialState: BotSettingsState = {
 tab: 'general',
 loaded: undefined,
 name: '',
 bio: '',
 avatar: undefined,
 conversation: undefined,
 aliases: '',
 busy: false,
 error: '',
 notice: '',
 crop: undefined
};

export type LoadArgs = {
 bot: Bot;
 owner: string;
 keep: boolean;
 nextRequest: () => number;
 isValid: (request: number) => boolean;
};

export type SettingsContext = {
 bot: Bot;
 owner: string;
 supported: boolean;
 refresh: () => Promise<unknown>;
 onClose: () => void;
 nextRequest: () => number;
 isValid: (request: number) => boolean;
};

/** Хранилище окна настроек бота: вкладка, черновик, загрузка и сохранение. */
export function createBotSettingsModel() {
 let saving = false;
 const store = createStore<BotSettingsState>(() => initialState);

 const load = async ({bot, owner, keep, nextRequest, isValid}: LoadArgs) => {
  const request = nextRequest();
  store.setState({busy: true, error: ''});
  try {
   const value = await botService.settings<BotSettings>({bot: bot.id});
   if (!isValid(request)) return;
   const settings = botSettingsResponse(value, bot, owner);
   store.setState({loaded: settings});
   if (!keep)
    store.setState({
     name: settings.profile.name,
     bio: settings.profile.bio,
     avatar: undefined,
     conversation: settings.conversation,
     aliases: settings.conversation.aliases.join(', ')
    });
   else
    store.setState({
     notice: 'Настройки изменились. Свежая версия загружена, ваш черновик сохранён. Проверьте его и сохраните снова.'
    });
  } catch {
   if (isValid(request)) store.setState({error: 'Не удалось загрузить настройки бота. Повторите загрузку.'});
  } finally {
   if (isValid(request)) store.setState({busy: false});
  }
 };

 const actions = {
  setTab(tab: string) {
   store.setState({tab});
  },
  setName(name: string) {
   store.setState({name});
  },
  setBio(bio: string) {
   store.setState({bio});
  },
  setAliases(aliases: string) {
   store.setState({aliases});
  },
  setAvatar(avatar: string | undefined) {
   store.setState({avatar});
  },
  setCrop(crop: File | undefined) {
   store.setState({crop});
  },
  setError(error: string) {
   store.setState({error});
  },
  /** Правка общения: поля продолжения и режима меняются только вместе с загруженным черновиком. */
  updateConversation(patch: Partial<BotConversation>) {
   const {conversation} = store.getState();
   if (conversation) store.setState({conversation: {...conversation, ...patch}});
  },
  load,
  /** Сохранение живёт здесь: права, конфликт ревизии и тексты ошибок — правило продукта. */
  async save({bot, owner, supported, refresh, onClose, nextRequest, isValid}: SettingsContext) {
   const state = store.getState();
   if (state.busy || !state.loaded || !supported || saving) return;
   const aliases = parseAliases(state.aliases);
   const conversation = draftConversation(state.conversation, state.aliases);
   if (settingsInvalid(state.name, state.bio, aliases, conversation)) return;
   if (!settingsDirty(state.loaded, {name: state.name, bio: state.bio, avatar: state.avatar, conversation})) return;
   saving = true;
   const request = nextRequest();
   store.setState({busy: true, error: '', notice: ''});
   try {
    await botService.updateSettings<BotSettings>({
     bot: bot.id,
     revision: state.loaded.revision,
     profile: {
      name: state.name.trim(),
      bio: state.bio,
      ...(state.avatar !== undefined ? {avatar: state.avatar} : {})
     },
     conversation
    });
    if (!isValid(request)) return;
    await refresh();
    if (isValid(request)) onClose();
   } catch (reason) {
    if (!isValid(request)) return;
    if (String(reason).includes('BOT_SETTINGS_CONFLICT')) await load({bot, owner, keep: true, nextRequest, isValid});
    else store.setState({error: 'Не удалось сохранить настройки бота. Проверьте данные и повторите попытку.'});
   } finally {
    saving = false;
    if (isValid(request)) store.setState({busy: false});
   }
  }
 };

 return {store, actions};
}
