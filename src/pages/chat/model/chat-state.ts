// Снапшот состояния страницы: одно хранилище на страницу, потому что чат в окне один.
// Здесь же ревизии: более свежие группа, название переписки и предпочтения не перетираются опросом.
import {createStore} from 'zustand/vanilla';
import {accountService} from '@/entities/account';
import {sessionService, stateService} from '@/shared/api';
import type {ChatMessage, ChatPreferences, ChatState, Dialog, ProfileEffectTarget, User} from '@/shared/types';

export type ChatSnapshotState = {
 snapshot: ChatState | null;
 error: string;
 busy: boolean;
};

const initialState: ChatSnapshotState = {snapshot: null, error: '', busy: false};

export const chatSnapshotStore = createStore<ChatSnapshotState>(() => initialState);

/** Поколение правки аватара: ответ опроса, начатый до неё, не должен вернуть старую картинку. */
let mediaGeneration = 0;
/** Опрос идёт строго по одному запросу: зависший запрос не копится за двухсекундным тиком. */
let polling = false;
/** Поколение страницы: ответ, пришедший после размонтирования, не должен оживить снапшот. */
let pageGeneration = 0;
/**
 * Сериализация последнего применённого ответа сервера. Опрос идёт каждые 2 секунды,
 * и обычно в нём ничего не меняется: без этой проверки каждый тик и каждая отправка
 * заново рендерили всё дерево чата. Сравнение точное, порядок ключей у сервера
 * стабильный (serde_json сохраняет порядок вставки).
 */
let lastApplied = '';
/**
 * Списки снапшота — по одному элементу на id. Сервер в редких случаях присылает
 * одну и ту же сущность дважды (например, диалог и в списке, и среди каналов),
 * и тогда каждый список с `key={id}` печатает предупреждение на каждом рендере.
 */
function uniqueById<T extends {id: string}>(items: T[]): T[] {
 if (!Array.isArray(items) || items.length < 2) return items;
 const seen = new Set<string>();
 const unique = items.filter(item => {
  if (!item?.id || seen.has(item.id)) return false;
  seen.add(item.id);
  return true;
 });
 return unique.length === items.length ? items : unique;
}

const patchSnapshot = (update: (state: ChatState) => ChatState) => {
 chatSnapshotStore.setState(current => ({
  ...current,
  snapshot: current.snapshot ? update(current.snapshot) : current.snapshot
 }));
};

const mergeDialogs = (previous: Dialog[], next: Dialog[]) => {
 const previousById = new Map(previous.map(dialog => [dialog.id, dialog]));
 return uniqueById(next).map(dialog => {
  const old = previousById.get(dialog.id);
  return old && (old.revision || 0) > (dialog.revision || 0)
   ? {...dialog, name: old.name, avatar: old.avatar, revision: old.revision}
   : dialog;
 });
};

export const chatSnapshotActions = {
 reset() {
  chatSnapshotStore.setState(initialState, true);
  mediaGeneration = 0;
  polling = false;
  pageGeneration++;
  lastApplied = '';
 },
 setError(error: string) {
  chatSnapshotStore.setState({error});
 },
 clearError() {
  chatSnapshotStore.setState({error: ''});
 },
 setBusy(busy: boolean) {
  chatSnapshotStore.setState({busy});
 },
 /** Свежий снапшот заменяет старый, но опубликованные изменения группы и переписки остаются. */
 applyState(incoming: ChatState) {
  const next: ChatState = {
   ...incoming,
   messages: uniqueById(incoming.messages),
   dialogs: uniqueById(incoming.dialogs),
   users: uniqueById(incoming.users),
   groups: uniqueById(incoming.groups)
  };
  const serialized = JSON.stringify(next);
  if (serialized === lastApplied) return;
  lastApplied = serialized;
  chatSnapshotStore.setState(current => {
   const previous = current.snapshot;
   if (!previous || previous.me.id !== next.me.id) return {...current, snapshot: next};
   const groups = next.groups.map(group => {
    const old = previous.groups.find(item => item.id === group.id);
    return old && (old.rolesRevision || 0) > (group.rolesRevision || 0) ? old : group;
   });
   const chatPreferences =
    previous.chatPreferences &&
    (!next.chatPreferences || (next.chatPreferences.revision || 0) < (previous.chatPreferences.revision || 0))
     ? previous.chatPreferences
     : next.chatPreferences;
   return {
    ...current,
    snapshot: {...next, groups, chatPreferences, dialogs: mergeDialogs(previous.dialogs, next.dialogs)}
   };
  });
 },
 /** Один шаг опроса: скрытый документ не грузим, ошибка показывается только живому экрану. */
 async load(isAlive: () => boolean) {
  if (polling || document.visibilityState === 'hidden') return;
  polling = true;
  const generation = mediaGeneration;
  try {
   const next = await stateService.load<ChatState>({sticker_assets: true});
   if (isAlive() && generation === mediaGeneration) chatSnapshotActions.applyState(next);
  } catch (reason) {
   if (isAlive()) chatSnapshotActions.setError((reason as Error).message);
  } finally {
   polling = false;
  }
 },
 /** Загрузка по требованию: возвращает снапшот, чтобы вызывающий сам решил, что с ним делать. */
 async refresh() {
  const generation = mediaGeneration;
  const page = pageGeneration;
  const next = await stateService.load<ChatState>({sticker_assets: true});
  if (generation === mediaGeneration && page === pageGeneration) chatSnapshotActions.applyState(next);
  return next;
 },
 /** Ответ на отправку приходит раньше опроса: сообщение сразу в переписке, но только один раз. */
 appendMessage(message: ChatMessage) {
  patchSnapshot(previous =>
   previous.me.id !== message.user || previous.messages.some(item => item.id === message.id)
    ? previous
    : {...previous, messages: [...previous.messages, message]}
  );
 },
 /** Сохранённые сведения переписки авторитетнее опроса, пока опрос не принесёт ту же ревизию. */
 async savedDialogMetadata(owner: string, dialog: Dialog) {
  patchSnapshot(previous =>
   previous.me.id === owner
    ? {
       ...previous,
       dialogs: previous.dialogs.map(item =>
        item.id === dialog.id && (item.revision || 0) <= (dialog.revision || 0)
         ? {...item, name: dialog.name, avatar: dialog.avatar, owner: dialog.owner, revision: dialog.revision}
         : item
       )
      }
    : previous
  );
  try {
   const next = await stateService.load<ChatState>({sticker_assets: true});
   if (next.me.id !== owner) return;
   patchSnapshot(previous =>
    previous.me.id === owner ? {...previous, dialogs: mergeDialogs(previous.dialogs, next.dialogs)} : previous
   );
  } catch {
   /* Сохранённые данные уже в снапшоте, обычный опрос повторит обновление. */
  }
 },
 applyChatPreferences(owner: string, preferences: ChatPreferences) {
  patchSnapshot(previous =>
   previous.me.id === owner && (preferences.revision || 0) >= (previous.chatPreferences?.revision || 0)
    ? {...previous, chatPreferences: preferences}
    : previous
  );
 },
 /** Правка аватара вернулась с сервера: обновляем себя и этого же человека в списке участников. */
 mediaSaved(user: User, field: 'avatar' | 'cover' | 'decoration:avatar' | 'decoration:cover') {
  mediaGeneration++;
  const merge = (old: User): User => {
   if (old.id !== user.id) return old;
   if (field === 'avatar' || field === 'cover') return {...old, [field]: user[field]};
   const target = field === 'decoration:avatar' ? 'avatar' : 'cover';
   return {
    ...old,
    decorations: {...old.decorations, [target]: user.decorations?.[target]},
    decorationRefs: {...old.decorationRefs, [target]: user.decorationRefs?.[target]},
    profileEffectAssets: {...old.profileEffectAssets, [target]: user.profileEffectAssets?.[target]}
   };
  };
  patchSnapshot(previous =>
   previous.me.id === user.id ? {...previous, me: merge(previous.me), users: previous.users.map(merge)} : previous
  );
 },
 /** Украшение профиля применяется только к тому же аккаунту и в том же сеансе. */
 async equipProfileEffect(id: string, target: ProfileEffectTarget) {
  const account = chatSnapshotStore.getState().snapshot?.me.id;
  const token = sessionService.token();
  if (!account) throw new Error('Учётная запись недоступна');
  const {user, item} = await accountService.applyProfileEffect(id);
  if (sessionService.token() !== token || user.id !== account || item.target !== target)
   throw new Error('Не удалось обновить украшение профиля');
  chatSnapshotActions.mediaSaved(user, `decoration:${target}`);
 }
};
