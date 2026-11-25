import type {VoicePresence} from '@/shared/types';
import type {VoiceState} from './voice-store';

export const selectVoiceRoom = (state: VoiceState) => state.room;
export const selectVoiceBusy = (state: VoiceState) => state.busy;
export const selectVoiceError = (state: VoiceState) => state.error;
export const selectVoicePeers = (state: VoiceState) => state.peers;
export const selectVoiceStreams = (state: VoiceState) => state.streams;
export const selectVoiceConnections = (state: VoiceState) => state.connections;
export const selectVoiceLocal = (state: VoiceState) => state.local;
export const selectVoiceCamera = (state: VoiceState) => state.camera;
export const selectVoicePreferences = (state: VoiceState) => state.preferences;
const missingInput = {muted: true, deaf: false};
const missingInputDeaf = {muted: true, deaf: true};
export const selectVoiceAvailability = (state: VoiceState) =>
 state.microphoneLost ? (state.availability.deaf ? missingInputDeaf : missingInput) : state.availability;
export const selectVoiceMuted = (state: VoiceState) => state.microphoneLost || state.availability.muted;
export const selectVoiceDeaf = (state: VoiceState) => state.availability.deaf;
export const selectVoiceMicVolume = (state: VoiceState) => state.micVolume;

export const selectVoiceActions = (state: VoiceState) => state.actions;

export function selectVoiceChannelMembers(
 voice: Pick<VoiceState, 'room'> & {muted: boolean; deaf: boolean},
 room: string,
 ownUser: string,
 presence: readonly VoicePresence[] = []
) {
 const joined = voice.room === room;
 const members = presence.map(({user, muted, deaf}) => {
  const self = joined && user === ownUser;
  return {id: user, self, muted: self ? voice.muted : muted, deaf: self ? voice.deaf : deaf};
 });
 // Admission can finish before the next chat snapshot.
 if (joined && !members.some(member => member.self))
  members.push({id: ownUser, self: true, muted: voice.muted, deaf: voice.deaf});
 return members;
}

export const selectVoiceView = (state: VoiceState) => ({
 room: state.room,
 busy: state.busy,
 error: state.error,
 camera: state.camera,
 audioOnly: state.audioOnly,
 local: state.local,
 peers: state.peers,
 streams: state.streams,
 connections: state.connections,
 preferences: state.preferences,
 micVolume: state.micVolume,
 microphoneLost: state.microphoneLost,
 ...selectVoiceAvailability(state)
});

export function selectRoomParticipants(
 voice: Pick<VoiceState, 'room' | 'peers'> & {muted: boolean; deaf: boolean},
 room: string,
 ownUser: string,
 presence: VoicePresence[] = []
) {
 if (voice.room !== room)
  return presence.map(p => ({key: p.user, id: p.user, self: false, muted: p.muted, deaf: p.deaf}));
 return [
  {key: 'self', id: ownUser, self: true, muted: voice.muted, deaf: voice.deaf},
  ...voice.peers
   .filter(peer => peer.user !== ownUser)
   .map(p => ({key: p.client, id: p.user, self: false, muted: p.muted, deaf: p.deaf}))
 ];
}
