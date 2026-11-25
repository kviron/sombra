import type {MusicCommand, MusicSnapshot, MusicTrack} from '@/shared/types';
export type {MusicCommand, MusicSnapshot} from '@/shared/types';

// Чистые правила музыки комнаты: позиция трека, проверка команд, подписи и очередь.
// Сети и DOM здесь нет, поэтому правила проверяются тестами.
export const MAX_PRIVATE_AUDIO = 10 * 1024 * 1024;

export type MusicReading = {state: MusicSnapshot; received: number};
export type PrivateAudio = {room: string; trackId: string; url: string};

/** Время получения снапшота — середина запроса: часы сервера и клиента не совпадают. */
export function receivedAt(started: number, now: number) {
 return (started + now) / 2;
}

/** Позиция трека на клиенте: серверная позиция плюс время, прошедшее после ответа. */
export function trackPosition(reading: MusicReading, now: number) {
 return Math.max(
  0,
  Math.min(
   reading.state.track?.durationMs ?? 0,
   reading.state.positionMs + (reading.state.status === 'playing' ? now - reading.received : 0)
  )
 );
}

/** Ответ на медленный запрос не должен откатывать уже показанную позицию. */
export function isFreshSnapshot(previous: MusicReading | null, state: MusicSnapshot) {
 if (!previous || previous.state.room !== state.room) return true;
 if (previous.state.serverTimeMs === state.serverTimeMs) return state.revision >= previous.state.revision;
 return state.serverTimeMs > previous.state.serverTimeMs;
}

export type CommandArgs = {room: string | undefined; action: MusicCommand; url?: string; limit?: number};

/** Проверка команды до запроса: порядок сообщений совпадает с прежним поведением команд. */
export function commandProblem({room, action, url, limit}: CommandArgs): string | undefined {
 if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 1000))
  return 'Укажите число треков от 1 до 1000.';
 if (!room) return 'Сначала войдите в голосовую комнату.';
 if (action === 'add' && !url) return 'Укажите ссылку после /play.';
 if (action !== 'add' && url) return 'Эта команда не принимает ссылку.';
 return undefined;
}

/** Ошибка сервера музыки важнее общего текста: по коду понятно, что чинить. */
export function commandFailureMessage(error: unknown) {
 const raw = String(error);
 if (raw.includes('MUSIC_PROVIDER_NOT_CONFIGURED')) return 'Яндекс Музыка пока не подключена на сервере.';
 if (raw.includes('MUSIC_SOURCE_NOT_APPROVED')) return 'Эта ссылка не входит в разрешённый каталог комнаты.';
 return 'Не удалось выполнить команду музыки. Проверьте подключение к комнате.';
}

export function trackTime(ms: number) {
 const seconds = Math.floor(ms / 1000);
 return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

type SourceArgs = {
 room: string | undefined;
 assetId: string | undefined;
 trackId: string | undefined;
 track: MusicTrack | null;
 privateAudio: PrivateAudio | undefined;
};

/** Ссылка для проигрывателя: приватный файл комнаты важнее публичного адреса трека. */
export function playbackSource({room, assetId, trackId, track, privateAudio}: SourceArgs) {
 if (!assetId) return track?.url;
 if (!room || !privateAudio || privateAudio.room !== room || privateAudio.trackId !== trackId) return undefined;
 return privateAudio.url;
}

type StatusArgs = {joined: boolean; unavailable: boolean; hasTrack: boolean; playing: boolean};

export function trackStatusText({joined, unavailable, hasTrack, playing}: StatusArgs) {
 if (!joined) return 'Войдите в комнату, чтобы включить музыку';
 if (unavailable) return 'Музыка недоступна на этом сервере';
 if (!hasTrack) return 'Добавьте трек в общую очередь';
 return playing ? 'Сейчас играет' : 'На паузе';
}

export function addDisabled({
 joined,
 unavailable,
 pending,
 hasLink
}: {
 joined: boolean;
 unavailable: boolean;
 pending: boolean;
 hasLink: boolean;
}) {
 return !joined || unavailable || pending || !hasLink;
}

export function visibleQueue(queue: MusicTrack[], pageSize: number) {
 return queue.slice(0, pageSize);
}

export function hasMoreQueue(queue: MusicTrack[], pageSize: number) {
 return queue.length > pageSize;
}
