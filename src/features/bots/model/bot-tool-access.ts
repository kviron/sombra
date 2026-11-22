// Хранилище панели доступа к инструментам: раскрытие, политика и черновик выбора.
// Хранилище фабричное: политика принадлежит раскрытой панели одного бота и живёт ровно
// столько же, сколько панель, поэтому модульный store оставил бы чужой черновик после закрытия.
import {createStore} from 'zustand/vanilla';
import type {Bot, ChatState} from '@/shared/types';
import {
 type ToolPolicy,
 isToolPolicyConflict,
 normalizedUsers,
 toolAccessDirty,
 toolAccessDisabled,
 toolAccessFull,
 toolAccessHumans,
 toolAccessWithinLimit,
 toolAccountChanged,
 toolConflictNotice,
 toolInvalidSelection,
 toolLimitNotice,
 toolLoadFailed,
 toolOwnerChangedOnLoad,
 toolOwnerChangedOnSave,
 toolPolicyResponse,
 toolReloadedNotice,
 toolSaveFailed,
 toolSavedNotice,
 toggleToolUser
} from './bot-tool-access-rules';
import {botService} from './services/bot-service';

export type BotToolAccessState = {
 expanded: boolean;
 policy: ToolPolicy | undefined;
 draft: string[];
 query: string;
 pending: boolean;
 notice: string;
 error: string;
 blocked: boolean;
};

const initialState: BotToolAccessState = {
 expanded: false,
 policy: undefined,
 draft: [],
 query: '',
 pending: false,
 notice: '',
 error: '',
 blocked: false
};

/** Защита от гонок: номер запроса и признак того, что ответ ещё нужен этому экземпляру. */
export type RequestGuard = {nextRequest: () => number; isValid: (request: number) => boolean};
export type LoadArgs = RequestGuard & {bot: Bot; keep: boolean};
export type PolicyArgs = RequestGuard & {bot: Bot; state: ChatState; rootBusy: boolean};

export function createBotToolAccessModel() {
 const store = createStore<BotToolAccessState>(() => initialState);

 const load = async ({bot, keep, nextRequest, isValid}: LoadArgs) => {
  const request = nextRequest();
  store.setState({pending: true, error: ''});
  try {
   const next = toolPolicyResponse(await botService.toolUsers({bot: bot.id}));
   if (!isValid(request)) return;
   // Владелец сменился, пока шёл запрос: приватная политика больше не наша.
   if (next.owner !== bot.owner) {
    store.setState({blocked: true, policy: undefined, error: toolOwnerChangedOnLoad});
    return;
   }
   store.setState({policy: next});
   if (keep) store.setState({notice: toolReloadedNotice});
   else store.setState({draft: next.users});
  } catch (reason) {
   if (isValid(request)) store.setState({error: (reason as Error).message || toolLoadFailed});
  } finally {
   if (isValid(request)) store.setState({pending: false});
  }
 };

 const actions = {
  /** Закрытая панель забывает политику: следующее раскрытие начинает с чистой загрузки. */
  collapse() {
   store.setState({...initialState});
  },
  toggle() {
   store.setState(store.getState().expanded ? {...initialState} : {expanded: true});
  },
  setQuery(query: string) {
   store.setState({query});
  },
  /** Аккаунт сменился: ответ, начатый до этого, не должен оживить чужую политику. */
  invalidate() {
   store.setState({blocked: true, policy: undefined, draft: [], pending: false, error: toolAccountChanged});
  },
  /** Отметка пользователя: предел проверяется до изменения черновика, как в разметке. */
  select({rootBusy, id, checked}: {rootBusy: boolean; id: string; checked: boolean}) {
   const {pending, blocked, policy, draft} = store.getState();
   if (toolAccessDisabled({pending, rootBusy, blocked, policy})) return;
   if (checked && toolAccessFull(draft, id)) {
    store.setState({error: toolLimitNotice});
    return;
   }
   store.setState({draft: toggleToolUser(draft, id, checked), notice: '', error: ''});
  },
  load,
  /** Сохранение живёт здесь: права, ревизия, конфликт и тексты — правило продукта. */
  async save({bot, state, rootBusy, nextRequest, isValid}: PolicyArgs) {
   const {policy, draft, pending, blocked} = store.getState();
   if (toolAccessDisabled({pending, rootBusy, blocked, policy}) || !policy) return;
   if (!toolAccessDirty(policy, draft) || !toolAccessWithinLimit(draft)) return;
   if (toolInvalidSelection(draft, toolAccessHumans(state, bot)).length) return;

   const request = nextRequest();
   store.setState({pending: true, error: '', notice: ''});
   try {
    const next = toolPolicyResponse(
     await botService.setToolUsers({bot: bot.id, users: normalizedUsers(draft), revision: policy.revision})
    );
    if (!isValid(request)) return;
    if (next.owner !== bot.owner) {
     store.setState({blocked: true, policy: undefined, error: toolOwnerChangedOnSave});
     return;
    }
    store.setState({policy: next, draft: next.users, notice: toolSavedNotice});
   } catch (reason) {
    if (!isValid(request)) return;
    const message = (reason as Error).message;
    if (isToolPolicyConflict(message)) {
     store.setState({notice: toolConflictNotice});
     await load({bot, keep: true, nextRequest, isValid});
    } else store.setState({error: message || toolSaveFailed});
   } finally {
    if (isValid(request)) store.setState({pending: false});
   }
  }
 };

 return {store, actions};
}
