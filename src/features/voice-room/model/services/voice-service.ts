import {api} from '@/shared/api';
import type {VoiceAvailability, VoiceClient, VoicePoll, VoiceSignalPayload} from '@/shared/types';

/** Голосовая комната: вход, опрос сигнализации, выход и обмен сигналами WebRTC. */
export const voiceService = {
 join: (payload: VoiceClient & VoiceAvailability) => api.voice.join<VoicePoll>({...payload, supportsLiveKit: true}),
 poll: (payload: VoiceClient & VoiceAvailability & {after: number; refreshIce?: boolean}) =>
  api.voice.poll<VoicePoll>(payload),
 leave: (payload: VoiceClient) => api.voice.leave(payload),
 signal: (payload: VoiceClient & {target: string; payload: VoiceSignalPayload}) => api.voice.signal(payload)
};
