export type MusicTrack = {
 id: string;
 title: string;
 artist?: string;
 coverUrl?: string;
 url?: string;
 assetId?: string;
 stream?: boolean;
 durationMs: number;
};

export type MusicSnapshot = {
 room: string;
 revision: number;
 serverTimeMs: number;
 positionMs: number;
 status: 'idle' | 'playing' | 'paused';
 track: MusicTrack | null;
 queue: MusicTrack[];
};

export type MusicCommand = 'add' | 'pause' | 'resume' | 'skip' | 'stop' | 'shuffle';
