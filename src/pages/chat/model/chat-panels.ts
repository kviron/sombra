// Окна и панели страницы: настройки аккаунта, общее окно действий, материалы и профиль.
// Хранилище модульное: страница в окне одна, а черновик формы живёт в том же объекте, что и режим окна.
import {createStore} from 'zustand/vanilla';
import type {GroupSettingsSection} from '@/features/group-management';
import type {MaterialCategory} from '@/entities/message';
import type {Channel, Group} from '@/shared/types';

/**
 * Раздел окна настроек: какие экраны существуют, знает страница, а не отдельная фича.
 * Поэтому тип живёт в модели композиции, а меню получает разделы списком.
 */
export type AccountSection =
 'profile' | 'security' | 'sessions' | 'voice' | 'updates' | 'stickers' | 'notifications' | 'storage' | 'journal';

export type ChatPanelsState = {
 settings: boolean;
 accountSection: AccountSection;
 modal: string;
 name: string;
 selected: string[];
 channelKind: string;
 editingChannel: {group: string; channel: Channel} | null;
 editingGroup: Pick<Group, 'id' | 'name' | 'avatar'> | null;
 members: boolean;
 profileId: string;
 headerProfile: boolean;
 infoOpen: boolean;
 materialsOpen: boolean;
 materialsCategory: MaterialCategory | 'all';
 materialsEpoch: number;
 botSettingsId: string;
 rolesGroupId: string;
 groupSettingsSection: GroupSettingsSection;
};

const initialState: ChatPanelsState = {
 settings: false,
 accountSection: 'profile',
 modal: '',
 name: '',
 selected: [],
 channelKind: 'text',
 editingChannel: null,
 editingGroup: null,
 members: false,
 profileId: '',
 headerProfile: false,
 infoOpen: false,
 materialsOpen: false,
 materialsCategory: 'all',
 materialsEpoch: 0,
 botSettingsId: '',
 rolesGroupId: '',
 groupSettingsSection: 'general'
};

export const chatPanelsStore = createStore<ChatPanelsState>(() => initialState);

export const chatPanelsActions = {
 reset() {
  chatPanelsStore.setState(initialState, true);
 },
 openSettings(section: AccountSection) {
  chatPanelsStore.setState({accountSection: section, settings: true});
 },
 closeSettings() {
  chatPanelsStore.setState({settings: false});
 },
 setAccountSection(accountSection: AccountSection) {
  chatPanelsStore.setState({accountSection});
 },
 /** Общее окно действий: черновик каждый раз начинается пустым. */
 openModal(modal: string, channelKind: string) {
  chatPanelsStore.setState({modal, name: '', selected: [], channelKind});
 },
 closeModal() {
  chatPanelsStore.setState({modal: ''});
 },
 setName(name: string) {
  chatPanelsStore.setState({name});
 },
 setChannelKind(channelKind: string) {
  chatPanelsStore.setState({channelKind});
 },
 toggleSelected(id: string, checked: boolean) {
  chatPanelsStore.setState(current => ({
   selected: checked
    ? current.selected.includes(id) || current.selected.length >= 9
      ? current.selected
      : [...current.selected, id]
    : current.selected.filter(item => item !== id)
  }));
 },
 /** Правка канала начинается с его текущего названия. */
 startEditChannel(editingChannel: {group: string; channel: Channel}) {
  chatPanelsStore.setState({editingChannel, name: editingChannel.channel.name, modal: 'edit-channel'});
 },
 startDeleteChannel() {
  chatPanelsStore.setState({modal: 'delete-channel'});
 },
 backToEditChannel() {
  chatPanelsStore.setState({modal: 'edit-channel'});
 },
 closeEditingChannel() {
  chatPanelsStore.setState({editingChannel: null});
 },
 editGroup(group: Group) {
  chatPanelsStore.setState({groupSettingsSection: 'general', rolesGroupId: group.id});
 },
 openRoles(groupId: string, section: GroupSettingsSection) {
  chatPanelsStore.setState({groupSettingsSection: section, rolesGroupId: groupId});
 },
 closeRoles() {
  chatPanelsStore.setState({rolesGroupId: ''});
 },
 openGroupStickers(editingGroup: Pick<Group, 'id' | 'name' | 'avatar'>) {
  chatPanelsStore.setState({editingGroup, rolesGroupId: '', modal: 'group-stickers'});
 },
 closeGroupStickers() {
  chatPanelsStore.setState({editingGroup: null});
 },
 openBotSettings(botSettingsId: string) {
  chatPanelsStore.setState({botSettingsId});
 },
 closeBotSettings() {
  chatPanelsStore.setState({botSettingsId: ''});
 },
 setMembers(members: boolean) {
  chatPanelsStore.setState({members});
 },
 /** Материалы и список участников делят правую колонку: открытие одного закрывает другое. */
 toggleMembers(materialsOpen: boolean) {
  chatPanelsStore.setState(current => ({members: materialsOpen ? true : !current.members, materialsOpen: false}));
 },
 openInfo() {
  chatPanelsStore.setState({infoOpen: true});
 },
 closeInfo() {
  chatPanelsStore.setState({infoOpen: false, headerProfile: false});
 },
 /** Профиль из шапки личного диалога возвращает фокус в шапку после закрытия. */
 openProfile(profileId: string, headerProfile = false) {
  chatPanelsStore.setState({profileId, headerProfile});
 },
 closeProfile() {
  chatPanelsStore.setState({profileId: '', headerProfile: false});
 },
 openMaterials(category: MaterialCategory | 'all') {
  chatPanelsStore.setState(current => ({
   infoOpen: false,
   profileId: '',
   headerProfile: false,
   materialsCategory: category,
   materialsEpoch: current.materialsEpoch + 1,
   materialsOpen: true
  }));
 },
 toggleMaterials() {
  chatPanelsStore.setState(current => ({
   materialsCategory: 'all',
   materialsEpoch: current.materialsEpoch + 1,
   materialsOpen: !current.materialsOpen
  }));
 },
 closeMaterials() {
  chatPanelsStore.setState({materialsOpen: false});
 },
 /** Смена переписки закрывает сведения о чате и возвращает категорию материалов к «всему». */
 onChannelChange() {
  chatPanelsStore.setState({infoOpen: false, headerProfile: false, materialsCategory: 'all'});
 },
 /** Переход по уведомлению закрывает всё, что могло быть открыто поверх чата. */
 closeOverlays() {
  chatPanelsStore.setState({
   settings: false,
   modal: '',
   profileId: '',
   headerProfile: false,
   infoOpen: false,
   botSettingsId: '',
   rolesGroupId: '',
   materialsOpen: false
  });
 }
};
