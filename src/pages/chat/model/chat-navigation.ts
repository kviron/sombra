// Выбранная группа, канал и переписка: одно хранилище на страницу.
// Список переписок тоже здесь: его поиск и статус сохранения предпочтений — часть навигации.
import {createStore} from 'zustand/vanilla';

type ChatLocation = {
 home: boolean;
 groupId: string;
 channelId: string;
};

export type ChatNavigationState = ChatLocation & {
 previous: ChatLocation[];
 next: ChatLocation[];
 dialogSearch: string;
 preferencesBusy: Record<string, boolean>;
};

const initialState: ChatNavigationState = {
 home: true,
 groupId: '',
 channelId: '',
 previous: [],
 next: [],
 dialogSearch: '',
 preferencesBusy: {}
};

export const chatNavigationStore = createStore<ChatNavigationState>(() => initialState);

const locationOf = ({home, groupId, channelId}: ChatLocation): ChatLocation => ({home, groupId, channelId});

function navigate(update: Partial<ChatLocation>) {
 chatNavigationStore.setState(current => {
  const location = locationOf(current);
  const target = {...location, ...update};
  if (target.home === location.home && target.groupId === location.groupId && target.channelId === location.channelId)
   return current;
  return {...target, previous: [...current.previous, location], next: []};
 });
}

export const chatNavigationActions = {
 reset() {
  chatNavigationStore.setState(initialState, true);
 },
 /** Домашний режим — личные переписки и друзья. */
 openHome() {
  navigate({home: true, channelId: ''});
 },
 selectGroup(groupId: string) {
  navigate({home: false, groupId, channelId: ''});
 },
 /** Канал группы остаётся в выбранной группе. */
 selectChannel(channelId: string) {
  navigate({channelId});
 },
 openDialog(dialog: string) {
  navigate({home: true, channelId: dialog});
 },
 /** Переход в группу целиком или сразу в её канал (пересылка, профиль). */
 openGroup(groupId: string, channelId = '') {
  navigate({home: false, groupId, channelId});
 },
 /** Маршрут уведомления: домашний режим или группа с каналом, группой по умолчанию остаётся текущая. */
 openRoute({home, group, channel}: {home: boolean; group?: string; channel: string}) {
  navigate({home, ...(group !== undefined ? {groupId: group} : {}), channelId: channel});
 },
 back() {
  chatNavigationStore.setState(current => {
   const target = current.previous.at(-1);
   if (!target) return current;
   return {...target, previous: current.previous.slice(0, -1), next: [locationOf(current), ...current.next]};
  });
 },
 forward() {
  chatNavigationStore.setState(current => {
   const [target, ...next] = current.next;
   if (!target) return current;
   return {...target, previous: [...current.previous, locationOf(current)], next};
  });
 },
 setDialogSearch(dialogSearch: string) {
  chatNavigationStore.setState({dialogSearch});
 },
 clearChannel(channelId: string) {
  const remains = (entry: ChatLocation) => entry.channelId !== channelId;
  chatNavigationStore.setState(current => ({
   channelId: remains(current) ? current.channelId : '',
   previous: current.previous.filter(remains),
   next: current.next.filter(remains)
  }));
 },
 /** Группа покинута или удалена: если она была открыта, возвращаемся к перепискам. */
 leaveGroupScope(groupId: string) {
  const remains = (entry: ChatLocation) => entry.home || entry.groupId !== groupId;
  chatNavigationStore.setState(current => ({
   ...(remains(current) ? {} : {home: true, groupId: '', channelId: ''}),
   previous: current.previous.filter(remains),
   next: current.next.filter(remains)
  }));
 },
 setPreferencesBusy(id: string, busy: boolean) {
  chatNavigationStore.setState(current => ({preferencesBusy: {...current.preferencesBusy, [id]: busy}}));
 }
};
