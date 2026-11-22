import {useEffect} from 'react';
import {useStore} from 'zustand';
import {useDialogCalls} from '@/features/voice-room';
import type {Voice} from '@/features/voice-room';
import type {ChatState, DialogCall} from '@/shared/types';
import {chatSnapshotActions} from './chat-state';
import {
 dialogCallFor,
 participantVolume,
 participantVolumeKey,
 participantVolumesActions,
 participantVolumesStore,
 voiceRoomOf
} from './chat-calls';

type Options = {
 state: ChatState | null;
 voice: Voice;
 home: boolean;
 channelId: string;
 onOpenDialog: (id: string) => void;
};

/**
 * Звонки страницы: опрос и действия остаются в `useDialogCalls` среза voice-room,
 * здесь — какой звонок относится к открытой переписке и громкость участников.
 */
export function useChatCalls({state, voice, home, channelId, onOpenDialog}: Options) {
 const volumes = useStore(participantVolumesStore);
 const calls = useDialogCalls({
  state,
  voice,
  refresh: chatSnapshotActions.refresh,
  onOpenDialog
 });
 const currentDialogCall: DialogCall | undefined = dialogCallFor(calls.calls, home, channelId);
 const voiceRoom = voiceRoomOf(home, currentDialogCall);
 const meId = state?.me.id || '';

 useEffect(() => () => participantVolumesActions.reset(), []);

 return {
  ...calls,
  currentDialogCall,
  voiceRoom,
  volumeForUser: (id: string) => participantVolume(meId, id, volumes.volumes),
  setUserVolume: (id: string, volume: number) => {
   if (!meId) return;
   participantVolumesActions.set(participantVolumeKey(meId, id), volume);
  }
 };
}

export type ChatCallsModel = ReturnType<typeof useChatCalls>;
