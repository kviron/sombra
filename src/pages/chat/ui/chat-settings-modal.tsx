import type {RefObject} from 'react';
import {
 AccountSecurity,
 AccountSettingsModal,
 AttachmentCacheSettings,
 DiagnosticJournal,
 NotificationSettings
} from '@/features/account-settings';
import {UpdateSettings} from '@/features/updates';
import {StickerLibrary} from '@/entities/sticker';
import {VoiceSettings} from '@/features/voice-room';
import type {Voice} from '@/features/voice-room';
import type {ChatState} from '@/shared/types';
import type {ChatPanelsModel} from '../model/use-chat-panels';
import type {ChatStateModel} from '../model/use-chat-state';

type Props = {
 chat: ChatStateModel;
 state: ChatState | null;
 panels: ChatPanelsModel;
 call: Voice;
 panelRef: RefObject<HTMLDivElement | null>;
};

/** Окно настроек аккаунта: раздел выбирается панелью, содержимое — срезами ниже. */
export function ChatSettingsModal({chat, state, panels, call, panelRef}: Props) {
 if (!panels.settings) return null;
 return (
  <AccountSettingsModal
   me={state?.me}
   section={panels.accountSection}
   onSection={panels.actions.setAccountSection}
   onLogout={panels.actions.logout}
   onClose={panels.actions.closeSettings}
   panelRef={panelRef}
  >
   {panels.accountSection === 'journal' ? (
    <DiagnosticJournal />
   ) : panels.accountSection === 'updates' ? (
    <UpdateSettings inCall={!!call.room || call.busy} />
   ) : panels.accountSection === 'notifications' ? (
    <NotificationSettings
     preferences={state?.chatPreferences}
     ready={!!state}
     onSaved={preferences => {
      if (state) chat.actions.applyChatPreferences(state.me.id, preferences);
     }}
    />
   ) : panels.accountSection === 'storage' ? (
    <AttachmentCacheSettings key={state?.me.id || 'loading'} ready={!!state} onChanged={chat.actions.refresh} />
   ) : panels.accountSection === 'voice' ? (
    <VoiceSettings voice={call} />
   ) : panels.accountSection === 'stickers' && state ? (
    <StickerLibrary
     key={state.me.id}
     stickers={state.stickers}
     user={state.me.id}
     catalog={state.stickerCatalogSupported}
     refresh={chat.actions.refresh}
    />
   ) : (
    <AccountSecurity
     state={state}
     refresh={chat.actions.refresh}
     section={panels.accountSection}
     onMediaSaved={chat.actions.mediaSaved}
    />
   )}
  </AccountSettingsModal>
 );
}
