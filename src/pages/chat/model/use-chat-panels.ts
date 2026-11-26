import {useCallback, useEffect, useMemo} from 'react';
import {useStore} from 'zustand';
import {toast} from 'sonner';
import type {GroupSettingsSection} from '@/features/group-management';
import type {MaterialCategory} from '@/entities/message';
import {canGroup, groupService} from '@/entities/group';
import {authService} from '@/entities/user';
import {conversationService} from '@/entities/conversation';
import type {Channel, ChatState, Dialog, Group, GroupPermission, User} from '@/shared/types';
import type {Voice} from '@/features/voice-room';
import type {AccountSection} from '@/features/account-settings';
import {chatPanelsActions, chatPanelsStore} from './chat-panels';
import {chatNavigationActions} from './chat-navigation';
import {chatSnapshotActions, chatSnapshotStore} from './chat-state';
import {canEditGroup, defaultChannelKind, groupInviteCandidates} from './chat-rules';

type Options = {
 state: ChatState | null;
 home: boolean;
 channel: Dialog | Channel | undefined;
 peer: User | undefined;
 group: Group | undefined;
 voice: Voice;
};

/**
 * Окна и панели страницы: настройки аккаунта, сведения о переписке, материалы, профиль.
 * Отправка общей формы группы и канала тоже здесь: она меняет только эти окна и навигацию.
 */
export function useChatPanels({state, home, channel, peer, group, voice}: Options) {
 const panels = useStore(chatPanelsStore);
 const permits = useCallback(
  (target: Group | undefined, permission: GroupPermission) => !!state && canGroup(target, state.me.id, permission),
  [state]
 );

 const editingGroupData = state?.groups.find(item => item.id === panels.editingGroup?.id);
 const editingChannelGroup = state?.groups.find(item => item.id === panels.editingChannel?.group);
 const managedBot =
  state && !state.me.bot
   ? state.bots?.find(bot => bot.id === panels.botSettingsId && bot.owner === state.me.id)
   : undefined;
 const rolesGroup = state?.groups.find(item => item.id === panels.rolesGroupId);
 const profile =
  panels.profileId && state
   ? state.me.id === panels.profileId
     ? state.me
     : state.users.find(user => user.id === panels.profileId)
   : undefined;

 useEffect(() => () => chatPanelsActions.reset(), []);

 // Пункт меню приложения «Обновления» открывает раздел настроек поверх чата.
 useEffect(() => {
  const open = () => chatPanelsActions.openSettings('updates');
  window.addEventListener('sombra:open-updates', open);
  return () => window.removeEventListener('sombra:open-updates', open);
 }, []);

 // Смена переписки закрывает сведения о чате и возвращает категорию материалов к «всему».
 useEffect(() => {
  chatPanelsActions.onChannelChange();
  chatSnapshotActions.clearError();
 }, [channel?.id]);

 const actions = useMemo(
  () => ({
   openSettings(section: AccountSection) {
    chatPanelsActions.openSettings(section);
   },
   openOwnProfile() {
    chatPanelsActions.openSettings('profile');
   },
   /** Шестерёнка в профиле открывает последний раздел настроек. */
   openSettingsModal() {
    chatPanelsActions.openSettings(chatPanelsStore.getState().accountSection);
   },
   closeSettings() {
    chatPanelsActions.closeSettings();
   },
   /** Escape в открытом окне: закрыть окна и убрать ошибку, как это делает разметка. */
   dismiss() {
    chatPanelsActions.closeModal();
    chatPanelsActions.closeSettings();
    chatSnapshotActions.clearError();
   },
   /** Выход из аккаунта: страница размонтируется, ошибка показывается, если сервер не ответил. */
   async logout() {
    try {
     await authService.logout();
    } catch (reason) {
     chatSnapshotActions.setError((reason as Error).message);
    }
   },
   setAccountSection(section: AccountSection) {
    chatPanelsActions.setAccountSection(section);
   },
   /** Общее окно действий: тип канала по умолчанию зависит от права создавать текстовые. */
   openModal(mode: string) {
    chatPanelsActions.openModal(mode, defaultChannelKind(mode, permits(group, 'channels.create_text')));
    chatSnapshotActions.clearError();
   },
   closeModal() {
    chatPanelsActions.closeModal();
   },
   setName(name: string) {
    chatPanelsActions.setName(name);
   },
   setChannelKind(kind: string) {
    chatPanelsActions.setChannelKind(kind);
   },
   toggleSelected(id: string, checked: boolean) {
    chatPanelsActions.toggleSelected(id, checked);
   },
   startEditChannel(target: Channel) {
    if (!group || (!permits(group, 'channels.rename') && !permits(group, 'channels.delete'))) return;
    chatPanelsActions.startEditChannel({group: group.id, channel: target});
    chatSnapshotActions.clearError();
   },
   startDeleteChannel() {
    chatPanelsActions.startDeleteChannel();
    chatSnapshotActions.clearError();
   },
   backToEditChannel() {
    chatPanelsActions.backToEditChannel();
    chatSnapshotActions.clearError();
   },
   editGroup(target: Group) {
    if (!canEditGroup(state, target)) return;
    chatPanelsActions.editGroup(target);
   },
   openRoles(groupId: string, section: GroupSettingsSection) {
    chatPanelsActions.openRoles(groupId, section);
   },
   closeRoles() {
    chatPanelsActions.closeRoles();
   },
   /** Стикеры: личные открываются в настройках, групповые — отдельным окном с правом управления. */
   manageStickers(scope: 'personal' | 'group') {
    if (scope === 'group') {
     if (!group || !permits(group, 'stickers.manage')) return;
     chatPanelsActions.openGroupStickers({id: group.id, name: group.name, avatar: group.avatar});
     return;
    }
    chatPanelsActions.openSettings('stickers');
   },
   openGroupStickers(target: Group) {
    chatPanelsActions.openGroupStickers({id: target.id, name: target.name, avatar: target.avatar});
   },
   openBotSettings(id: string) {
    chatPanelsActions.openBotSettings(id);
   },
   closeBotSettings() {
    chatPanelsActions.closeBotSettings();
   },
   toggleMembers() {
    chatPanelsActions.toggleMembers(chatPanelsStore.getState().materialsOpen);
   },
   openMemberList() {
    chatPanelsActions.setMembers(true);
   },
   closeMemberList() {
    chatPanelsActions.setMembers(false);
   },
   /** Шапка личного диалога открывает профиль собеседника, остальные — сведения о чате. */
   openChatInfo() {
    if (home && channel && 'members' in channel && channel.members.length === 2) {
     if (peer) {
      chatPanelsActions.openProfile(peer.id, true);
      return;
     }
    }
    chatPanelsActions.openInfo();
   },
   closeInfo() {
    chatPanelsActions.closeInfo();
   },
   openProfile: chatPanelsActions.openProfile,
   closeProfile() {
    chatPanelsActions.closeProfile();
   },
   openMaterials(category: MaterialCategory | 'all') {
    chatPanelsActions.openMaterials(category);
   },
   toggleMaterials() {
    chatPanelsActions.toggleMaterials();
   },
   closeMaterials() {
    chatPanelsActions.closeMaterials();
   },
   onChannelChange() {
    chatPanelsActions.onChannelChange();
   },
   closeOverlays() {
    chatPanelsActions.closeOverlays();
   },
   /** Форма общего окна: invite, канал, диалог, группа или вступление по коду. */
   async submit() {
    const {modal, name, selected, channelKind, editingChannel} = chatPanelsStore.getState();
    if (chatSnapshotStore.getState().busy || modal === 'group-stickers') return;
    chatSnapshotActions.setBusy(true);
    chatSnapshotActions.clearError();
    try {
     if (modal === 'invite') {
      if (!group || !permits(group, 'members.invite')) return;
      const candidates = groupInviteCandidates(state?.users ?? [], group.members);
      const users = selected.filter(id => candidates.some(user => user.id === id));
      if (!users.length && !name.trim()) return;
      await groupService.invite({group: group.id, ...(users.length ? {users} : {email: name.trim()})});
      chatPanelsActions.closeModal();
      toast.success(users.length > 1 ? 'Участники добавлены в группу' : 'Участник добавлен в группу');
      await chatSnapshotActions.refresh();
      return;
     }
     if (modal === 'edit-channel' && editingChannel) {
      if (!permits(editingChannelGroup, 'channels.rename')) throw new Error('Нет права переименовывать каналы');
      await groupService.updateChannel({group: editingChannel.group, channel: editingChannel.channel.id, name});
     } else if (modal === 'delete-channel' && editingChannel) {
      if (!permits(editingChannelGroup, 'channels.delete')) throw new Error('Нет права удалять каналы');
      const target = editingChannel.channel.id;
      await groupService.deleteChannel({group: editingChannel.group, channel: target});
      if (voice.room === target) voice.leave();
      chatNavigationActions.clearChannel(target);
      chatPanelsActions.closeModal();
      toast.success('Канал удалён');
     } else if (modal === 'dialog') {
      const dialog = await conversationService.createDialog<Dialog>({name, members: selected});
      chatNavigationActions.openDialog(dialog.id);
     } else if (modal === 'group') {
      const created = await groupService.create<Group>({name});
      chatNavigationActions.openGroup(created.id);
     } else if (modal === 'join') {
      const joined = await groupService.join<Group>({invite: name.trim()});
      chatNavigationActions.openGroup(joined.id);
     } else if (modal === 'channel') {
      if (!permits(group, channelKind === 'voice' ? 'channels.create_voice' : 'channels.create_text'))
       throw new Error('Нет права создавать этот тип канала');
      const created = await groupService.createChannel<Channel>({group: group?.id, name, kind: channelKind});
      chatNavigationActions.selectChannel(created.id);
     }
     await chatSnapshotActions.refresh();
     chatPanelsActions.closeModal();
    } catch (reason) {
     chatSnapshotActions.setError((reason as Error).message);
    } finally {
     chatSnapshotActions.setBusy(false);
    }
   }
  }),
  [state, group, editingChannelGroup, permits, voice, home, channel, peer]
 );

 return {
  ...panels,
  editingGroupData,
  editingChannelGroup,
  managedBot,
  rolesGroup,
  profile,
  permissions: permits,
  actions
 };
}

export type ChatPanelsModel = ReturnType<typeof useChatPanels>;
