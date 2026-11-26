import {createStore} from 'zustand/vanilla';
import type {VoiceAvailability, VoicePeer} from '@/shared/types';
import type {MediaPreferences} from './voice-input';
import {reconcileVoicePeers} from './voice-peers.ts';

type VoiceActions = {
 beginOperation: () => void;
 finishOperation: () => void;
 setError: (error: string) => void;
 setPresenceDelayed: (presenceDelayed: boolean) => void;
 connected: (
  room: string,
  local: MediaStream,
  camera: boolean,
  peers: VoicePeer[],
  ownClient: string,
  audioOnly?: boolean
 ) => void;
 resetCall: (micVolume: number) => void;
 setLocal: (local: MediaStream) => void;
 setMicrophoneLost: (lost: boolean) => void;
 setCamera: (camera: boolean) => void;
 setPresenting: (presenting: boolean) => void;
 setMicVolume: (micVolume: number) => void;
 setPreferences: (preferences: MediaPreferences) => void;
 setAvailability: (availability: VoiceAvailability) => void;
 toggleMic: () => VoiceAvailability;
 toggleDeaf: () => VoiceAvailability;
 setPeers: (incoming: VoicePeer[], ownClient: string) => void;
 setRemoteStream: (id: string, stream: MediaStream | null) => void;
 setConnection: (id: string, connection: string | null) => void;
};

export type VoiceState = {
 room: string;
 busy: boolean;
 error: string;
 presenceDelayed: boolean;
 microphoneLost: boolean;
 camera: boolean;
 presenting: boolean;
 audioOnly: boolean;
 local: MediaStream | null;
 peers: VoicePeer[];
 streams: Record<string, MediaStream>;
 connections: Record<string, string>;
 preferences: MediaPreferences;
 availability: VoiceAvailability;
 micVolume: number;
 actions: VoiceActions;
};

// Each mounted voice session owns its store; independent clients must never share a call.
export function createVoiceStore(preferences: MediaPreferences) {
 return createStore<VoiceState>((set, get) => ({
  room: '',
  busy: false,
  error: '',
  microphoneLost: false,
  camera: false,
  presenting: false,
  audioOnly: false,
  local: null,
  peers: [],
  streams: {},
  connections: {},
  preferences: {...preferences},
  presenceDelayed: false,
  availability: {muted: false, deaf: false},
  micVolume: 100,
  actions: {
   beginOperation: () => set({busy: true, error: ''}),
   finishOperation: () => set({busy: false}),
   setError: error => set({error}),
   setPresenceDelayed: presenceDelayed => set({presenceDelayed}),
   connected: (room, local, camera, peers, ownClient, audioOnly = false) =>
    set({room, local, camera, audioOnly, peers: reconcileVoicePeers([], peers, ownClient)}),
   resetCall: micVolume =>
    set({
     room: '',
     presenceDelayed: false,
     busy: false,
     local: null,
     peers: [],
     streams: {},
     connections: {},
     camera: false,
     presenting: false,
     audioOnly: false,
     microphoneLost: false,
     micVolume
    }),
   setLocal: local => set({local}),
   setMicrophoneLost: microphoneLost => set({microphoneLost}),
   setCamera: camera => set({camera}),
   setPresenting: presenting => set({presenting}),
   setMicVolume: micVolume => set({micVolume}),
   setPreferences: preferences => set({preferences}),
   setAvailability: availability => set({availability}),
   toggleMic: () => {
    const {muted, deaf} = get().availability;
    const availability = {muted: !muted && !deaf, deaf: false};
    set({availability});
    return availability;
   },
   toggleDeaf: () => {
    const availability = {...get().availability, deaf: !get().availability.deaf};
    set({availability});
    return availability;
   },
   setPeers: (incoming, ownClient) =>
    set(state => {
     const peers = reconcileVoicePeers(state.peers, incoming, ownClient);
     return peers === state.peers ? state : {peers};
    }),
   setRemoteStream: (id, stream) =>
    set(state => {
     if (!stream && !(id in state.streams)) return state;
     const streams = {...state.streams};
     if (stream) streams[id] = stream;
     else delete streams[id];
     return {streams};
    }),
   setConnection: (id, connection) =>
    set(state => {
     if (state.connections[id] === connection || (!connection && !(id in state.connections))) return state;
     const connections = {...state.connections};
     if (connection) connections[id] = connection;
     else delete connections[id];
     return {connections};
    })
  }
 }));
}
export type VoiceStore = ReturnType<typeof createVoiceStore>;
