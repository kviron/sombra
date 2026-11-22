// Выбранная группа, канал и переписка: одно хранилище на страницу.
// Список переписок тоже здесь: его поиск и статус сохранения предпочтений — часть навигации.
import {createStore} from 'zustand/vanilla';

export type ChatNavigationState = {
 home: boolean;
 groupId: string;
 channelId: string;
 dialogSearch: string;
 preferencesBusy: Record<string, boolean>;
};

const initialState: ChatNavigationState = {
 home: true,
 groupId: '',
 channelId: '',
 dialogSearch: '',
 preferencesBusy: {}
};

export const chatNavigationStore = createStore<ChatNavigationState>(() => initialState);

export const chatNavigationActions = {
 reset() {
  chatNavigationStore.setState(initialState, true);
 },
 /** Домашний режим — личные переписки и друзья. */
 openHome() {
  chatNavigationStore.setState({home: true, channelId: ''});
 },
 selectGroup(groupId: string) {
  chatNavigationStore.setState({home: false, groupId, channelId: ''});
 },
 /** Канал группы остаётся в выбранной группе. */
 selectChannel(channelId: string) {
  chatNavigationStore.setState({channelId});
 },
 openDialog(dialog: string) {
  chatNavigationStore.setState({home: true, channelId: dialog});
 },
 /** Переход в группу целиком или сразу в её канал (пересылка, профиль). */
 openGroup(groupId: string, channelId = '') {
  chatNavigationStore.setState({home: false, groupId, channelId});
 },
 /** Маршрут уведомления: домашний режим или группа с каналом, группой по умолчанию остаётся текущая. */
 openRoute({home, group, channel}: {home: boolean; group?: string; channel: string}) {
  chatNavigationStore.setState(current => ({home, groupId: group ?? current.groupId, channelId: channel}));
 },
 setDialogSearch(dialogSearch: string) {
  chatNavigationStore.setState({dialogSearch});
 },
 clearChannel(channelId: string) {
  chatNavigationStore.setState(current => (current.channelId === channelId ? {channelId: ''} : {}));
 },
 /** Группа покинута или удалена: если она была открыта, возвращаемся к перепискам. */
 leaveGroupScope(groupId: string) {
  chatNavigationStore.setState(current =>
   current.home || current.groupId !== groupId ? {} : {home: true, groupId: '', channelId: ''}
  );
 },
 setPreferencesBusy(id: string, busy: boolean) {
  chatNavigationStore.setState(current => ({preferencesBusy: {...current.preferencesBusy, [id]: busy}}));
 }
};
