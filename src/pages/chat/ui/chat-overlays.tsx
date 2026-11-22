import type {ReactNode, RefObject} from 'react';
import {toast} from 'sonner';
import {NewDialogDialog} from '@/features/conversation-list';
import {BotSettingsDialog} from '@/features/bots';
import {GroupSettingsDialog} from '@/features/group-management';
import {ConversationInfoDialog} from '@/features/conversation-details';
import {ForwardPicker} from '@/features/message-actions';
import type {ForwardDestination} from '@/features/message-actions';
import {IncomingDialogCall} from '@/features/voice-room';
import type {Voice} from '@/features/voice-room';
import type {MaterialCategory} from '@/entities/message';
import type {ChatState} from '@/shared/types';
import {UserProfile} from './user-profile';
import type {ChatNavigationModel} from '../model/use-chat-navigation';
import type {ChatPanelsModel} from '../model/use-chat-panels';
import type {ChatMessagesModel} from '../model/use-chat-messages';
import type {ChatCallsModel} from '../model/use-chat-calls';
import type {ChatStateModel} from '../model/use-chat-state';
import {forwardDestinations} from '../model/chat-rules';

type Props = {
 chat: ChatStateModel;
 state: ChatState | null;
 nav: ChatNavigationModel;
 panels: ChatPanelsModel;
 messages: ChatMessagesModel;
 calls: ChatCallsModel;
 call: Voice;
 infoTrigger: RefObject<HTMLButtonElement | null>;
 onChooseForward: (destination: ForwardDestination) => void;
 onOpenMaterials: (category: MaterialCategory) => void;
 onOpenProfileFromInfo: (id: string) => void;
 /** Общее окно действий: стоит на своём месте в порядке наложения. */
 children?: ReactNode;
};

/** Всплывающие окна страницы: диалог, звонок, бот, роли, пересылка, сведения и профиль. */
export function ChatOverlays({
 chat,
 state,
 nav,
 panels,
 messages,
 calls,
 call,
 infoTrigger,
 onChooseForward,
 onOpenMaterials,
 onOpenProfileFromInfo,
 children
}: Props) {
 const {home, channel, group, title, friends, peer} = nav;
 const {managedBot, rolesGroup, profile} = panels;
 const picker = messages.picker;
 return (
  <>
   {panels.modal === 'dialog' && state && (
    <NewDialogDialog
     state={state}
     refresh={chat.actions.refresh}
     onClose={panels.actions.closeModal}
     onCreated={dialog => {
      nav.actions.openDialog(dialog.id);
      panels.actions.closeModal();
     }}
    />
   )}
   {calls.incoming && state && (
    <IncomingDialogCall
     call={calls.incoming}
     state={state}
     busy={calls.incomingBusy}
     declining={calls.incomingDeclining}
     hasOtherVoice={!!call.room && call.room !== calls.incoming.id}
     error={calls.error}
     onAccept={video => void calls.join(calls.incoming!, video)}
     onDecline={() => void calls.decline(calls.incoming!)}
    />
   )}
   {children}
   {managedBot && state && (
    <BotSettingsDialog
     bot={managedBot}
     state={state}
     refresh={chat.actions.refresh}
     onClose={panels.actions.closeBotSettings}
    />
   )}
   {rolesGroup && state && (
    <GroupSettingsDialog
     key={rolesGroup.id}
     initialSection={panels.groupSettingsSection}
     group={rolesGroup}
     state={state}
     onClose={panels.actions.closeRoles}
     refresh={chat.actions.refresh}
     onError={message => toast.error(message)}
     onManageStickers={id => {
      const target = state.groups.find(item => item.id === id);
      if (!target || !panels.permissions(target, 'stickers.manage')) return;
      panels.actions.openGroupStickers(target);
     }}
    />
   )}
   {picker && state && (
    <ForwardPicker
     source={picker.message}
     author={nav.userName(picker.message.user)}
     onClose={() => {
      const id = picker.message.id;
      messages.actions.closeForwardPicker();
      requestAnimationFrame(() =>
       document.querySelector<HTMLElement>(`[data-read-message-id="${CSS.escape(id)}"]`)?.focus({preventScroll: true})
      );
     }}
     onChoose={onChooseForward}
     destinations={forwardDestinations(state)}
    />
   )}
   {messages.linkDialog}
   {panels.infoOpen && channel && state && !friends && (
    <ConversationInfoDialog
     key={`${state.me.id}:${channel.id}`}
     state={state}
     title={home ? title : group?.name || title}
     channel={channel.id}
     dialog={home && 'members' in channel ? channel : undefined}
     onSaved={chat.actions.savedDialogMetadata}
     memberIds={home && 'members' in channel ? channel.members : group?.members || []}
     avatar={home && 'members' in channel ? channel.avatar : group?.avatar}
     channelLabel={!home ? channel.name : undefined}
     onClose={panels.actions.closeInfo}
     onProfile={onOpenProfileFromInfo}
     onMaterials={onOpenMaterials}
     onSettings={
      !home && group
       ? () => {
          panels.actions.closeInfo();
          requestAnimationFrame(() => panels.actions.openRoles(group.id, 'general'));
         }
       : undefined
     }
    />
   )}
   {profile && state && (
    <UserProfile
     key={`${state.me.id}:${profile.id}`}
     user={profile}
     me={state.me}
     groups={state.groups}
     onApplyEffect={state.effectCatalogSupported ? chat.actions.equipProfileEffect : undefined}
     restoreFocusRef={panels.headerProfile ? infoTrigger : undefined}
     conversationMaterials={
      panels.headerProfile &&
      home &&
      channel &&
      'members' in channel &&
      channel.members.length === 2 &&
      peer?.id === profile.id
       ? {messages: state.messages, channel: channel.id, onOpen: onOpenMaterials}
       : undefined
     }
     onClose={panels.actions.closeProfile}
     onOpenGroup={id => nav.actions.openGroup(id)}
    />
   )}
  </>
 );
}
