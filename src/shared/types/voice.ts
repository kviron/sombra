export type VoicePresence = {user: string; muted: boolean; deaf: boolean};

export type VoicePeer = {client: string; user: string; muted?: boolean; deaf?: boolean};
export type VoiceAvailability = {muted: boolean; deaf: boolean};
export type VoiceClient = {room: string; client: string};
export type VoiceSignalPayload = {
 connectionId?: string;
 iceVersion?: number;
 restartOf?: string;
 restart?: string;
 replace?: boolean;
 description?: RTCSessionDescriptionInit;
 candidate?: RTCIceCandidateInit;
 candidates?: RTCIceCandidateInit[];
};
export type VoicePoll = {
 peers: VoicePeer[];
 signals: {
  id: number;
  from: string;
  payload: VoiceSignalPayload;
 }[];
 cursor: number;
 iceServers: RTCIceServer[];
 iceTtlSeconds?: number;
 liveKit?: {url: string; token: string};
};
