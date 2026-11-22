import {useCallback, useEffect, useMemo, useRef} from 'react';
import {useStore} from 'zustand';
import {toast} from 'sonner';
import {canGroup, groupService} from '@/entities/group';
import {conversationService} from '@/entities/conversation';
import type {ChatPreferences, ChatState, Dialog, DialogPreferences, Group, GroupPermission} from '@/shared/types';
import type {ForwardDestination} from '@/features/message-actions';
import type {Voice} from '@/features/voice-room';
import {chatNavigationActions, chatNavigationStore} from './chat-navigation';
import {chatSnapshotActions, chatSnapshotStore} from './chat-state';
import {
 canEditGroup,
 channelFor,
 chatTitle,
 currentGroup,
 dialogList,
 dmPeerFor,
 friendsOpen,
 memberName,
 ownerDmBot,
 peerTypingUntil,
 preferencesForDialog
} from './chat-rules';

type Options = {state: ChatState | null; voice: Voice};

/**
 * Что показано на странице и как в это перейти: домашний режим, группа, канал и переписка.
 * Действия над группой из рейла и шапки (выйти, заменить приглашение) живут здесь же.
 */
export function useChatNavigation({state, voice}: Options) {
 const nav = useStore(chatNavigationStore);
 const pendingPreferences = useRef(new Set<string>());
 const group = currentGroup(state, nav.groupId);
 const channel = channelFor({home: nav.home, state, group, channelId: nav.channelId});
 const friends = friendsOpen(nav.home, nav.channelId);
 const title = chatTitle({home: nav.home, state, channel, group, friends});
 const peer = dmPeerFor({home: nav.home, state, channel});
 const dmBot = ownerDmBot(state, peer);
 const typingUntil = peerTypingUntil(state, peer, channel?.id || '');
 const {latest, dialogs} = useMemo(() => dialogList({state, search: nav.dialogSearch}), [state, nav.dialogSearch]);
 const userName = useCallback((id: string) => memberName(state?.users || [], id), [state?.users]);
 const permits = useCallback(
  (target: Group | undefined, permission: GroupPermission) => !!state && canGroup(target, state.me.id, permission),
  [state]
 );
 const canEdit = useCallback((target: Group | undefined) => canEditGroup(state, target), [state]);

 useEffect(() => () => chatNavigationActions.reset(), []);

 /** Переписка в списке: имя собеседника и сохранённые предпочтения. */
 const listRow = useCallback(
  (dialog: Dialog) => ({
   preferences: preferencesForDialog(state?.chatPreferences, dialog.id),
   busy: !!nav.preferencesBusy[dialog.id],
   last: latest.get(dialog.id)
  }),
  [state?.chatPreferences, nav.preferencesBusy, latest]
 );

 const actions = {
  openHome: chatNavigationActions.openHome,
  selectGroup: chatNavigationActions.selectGroup,
  selectChannel: chatNavigationActions.selectChannel,
  openDialog: chatNavigationActions.openDialog,
  openGroup: chatNavigationActions.openGroup,
  openRoute: chatNavigationActions.openRoute,
  setDialogSearch: chatNavigationActions.setDialogSearch,
  /** Пересылка: группа открывается вместе с каналом, личная переписка — в домашнем режиме. */
  openDestination(item: ForwardDestination) {
   if (item.group) chatNavigationActions.openGroup(item.group.id, item.id);
   else chatNavigationActions.openDialog(item.id);
  },
  /** Личная переписка с человеком: существующая или только что созданная. */
  async messageUser(id: string) {
   const snapshot = chatSnapshotStore.getState().snapshot;
   if (!snapshot || id === snapshot.me.id) return;
   const existing = snapshot.dialogs.find(
    dialog => dialog.members.length === 2 && dialog.members.includes(id) && dialog.members.includes(snapshot.me.id)
   );
   if (existing) {
    chatNavigationActions.openDialog(existing.id);
    return;
   }
   try {
    const dialog = await conversationService.createDialog<Dialog>({members: [id], name: ''});
    await chatSnapshotActions.refresh();
    chatNavigationActions.openDialog(dialog.id);
   } catch (reason) {
    toast.error((reason as Error).message);
   }
  },
  async leaveGroup(target: Group) {
   const {snapshot, busy} = chatSnapshotStore.getState();
   if (!snapshot || target.owner === snapshot.me.id || busy || !window.confirm(`Покинуть группу «${target.name}»?`))
    return;
   chatSnapshotActions.setBusy(true);
   try {
    await groupService.leave({group: target.id});
    if (target.channels.some(channel => channel.id === voice.room)) voice.leave();
    chatNavigationActions.leaveGroupScope(target.id);
    await chatSnapshotActions.refresh();
   } catch (reason) {
    toast.error((reason as Error).message);
   } finally {
    chatSnapshotActions.setBusy(false);
   }
  },
  async rotateInvite() {
   const {snapshot, busy} = chatSnapshotStore.getState();
   const current = currentGroup(snapshot, chatNavigationStore.getState().groupId);
   if (
    !current ||
    !permits(current, 'invite.rotate') ||
    busy ||
    !window.confirm('Заменить код приглашения? Старый код перестанет работать.')
   )
    return;
   chatSnapshotActions.setBusy(true);
   chatSnapshotActions.clearError();
   try {
    await groupService.rotateInvite({group: current.id});
    await chatSnapshotActions.refresh();
    toast.success('Код приглашения обновлён');
   } catch (reason) {
    chatSnapshotActions.setError((reason as Error).message);
   } finally {
    chatSnapshotActions.setBusy(false);
   }
  },
  /** Закрепление и отключение уведомлений: одна операция на переписку, ответ сервера авторитетен. */
  async changeDialogPreferences(dialog: string, patch: Partial<DialogPreferences>) {
   const snapshot = chatSnapshotStore.getState().snapshot;
   if (!snapshot || pendingPreferences.current.has(dialog)) return;
   const owner = snapshot.me.id;
   pendingPreferences.current.add(dialog);
   chatNavigationActions.setPreferencesBusy(dialog, true);
   try {
    chatSnapshotActions.applyChatPreferences(
     owner,
     await conversationService.setPreferences<ChatPreferences>({dialog, ...patch})
    );
   } catch (reason) {
    toast.error(reason instanceof Error ? reason.message : 'Не удалось сохранить настройки чата.');
   } finally {
    pendingPreferences.current.delete(dialog);
    chatNavigationActions.setPreferencesBusy(dialog, false);
   }
  }
 };

 return {
  home: nav.home,
  groupId: nav.groupId,
  channelId: nav.channelId,
  dialogSearch: nav.dialogSearch,
  group,
  channel,
  title,
  friends,
  peer,
  dmBot,
  typingUntil,
  dialogs,
  userName,
  permits,
  canEdit,
  canShowMembers: !nav.home && !!group,
  listRow,
  actions
 };
}

export type ChatNavigationModel = ReturnType<typeof useChatNavigation>;
