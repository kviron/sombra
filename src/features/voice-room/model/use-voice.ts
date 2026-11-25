import {useEffect, useState} from 'react';
import {useStore} from 'zustand';
import {useShallow} from 'zustand/react/shallow';
import {mediaDevicesStore, selectSpeakerOutput} from '@/shared/lib/media-devices';
import {readMedia} from './voice-input';
import {createVoiceSession} from './voice-session';
import {selectVoiceView} from './voice-selectors';

export function useVoice() {
 const [session] = useState(() => createVoiceSession(readMedia()));
 const state = useStore(session.store, useShallow(selectVoiceView));
 const speakerOutput = useStore(mediaDevicesStore, devices => selectSpeakerOutput(devices, state.preferences.speaker));
 useEffect(() => () => session.actions.leave(), [session]);
 return {...state, ...session.actions, store: session.store, speakerOutput};
}
export type Voice = ReturnType<typeof useVoice>;
