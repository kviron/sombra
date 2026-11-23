import type {RefObject} from 'react';
// Порядок импортов задаёт порядок каскада: стили разделов грузятся до стилей окна.
import {AccountSecurity} from '@/features/account-security';
import {ProfileDecorationPicker} from '@/features/profile-decoration';
import {ProfileMediaDialog} from '@/features/profile-media';
import {AccountSettingsModal} from './account-settings-modal';
import {AttachmentCacheSettings} from '@/features/account-storage';
import {DiagnosticJournal} from '@/features/account-diagnostics';
import {NotificationSettings} from '@/features/account-notifications';
import {UpdateSettings} from '@/features/updates';
import {StickerLibrary} from '@/entities/sticker';
import {VoiceSettings} from '@/features/voice-room';
import type {Voice} from '@/features/voice-room';
import type {ChatState} from '@/shared/types';
import {accountSections} from './account-sections';
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
   sections={accountSections}
   section={panels.accountSection}
   onSection={panels.actions.setAccountSection}
   onEditProfile={() => panels.actions.setAccountSection('profile')}
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
     mediaDialog={ProfileMediaDialog}
     decorationPicker={ProfileDecorationPicker}
    />
   )}
  </AccountSettingsModal>
 );
}
