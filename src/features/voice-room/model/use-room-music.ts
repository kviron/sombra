import {useEffect, useRef, type RefObject} from 'react';
import {useStore} from 'zustand';
import {musicService} from './services/music-service';
import {openRoomMusicStream} from './room-music-stream';
import {roomMusicActions, roomMusicStore} from './room-music';
import {
 addDisabled,
 hasMoreQueue,
 MAX_PRIVATE_AUDIO,
 playbackSource,
 trackPosition,
 trackStatusText,
 trackTime,
 visibleQueue,
 type MusicCommand,
 type MusicSnapshot
} from './room-music-rules';

/**
 * Музыка в комнате: опрос снапшота, загрузка приватного аудио, команды и синхронизация
 * проигрывателя. Элемент audio создаёт компонент и передаёт сюда ссылкой: DOM не хранится в модели.
 */
export function useRoomMusic(
 room: string | undefined,
 deaf: boolean,
 speaker: string,
 engine: RefObject<HTMLAudioElement | null>
) {
 const state = useStore(roomMusicStore);
 const epoch = useRef(0),
  lastTrack = useRef<string | undefined>(undefined);
 const current = room && state.room === room && state.reading?.state.room === room ? state.reading : null;
 const track = current?.state.track ?? null;
 const assetId = track?.assetId,
  trackId = track?.id;
 const playbackUrl = playbackSource({room, assetId, trackId, track, privateAudio: state.privateAudio});

 // Приватное аудио комнаты: поток для Яндекса или файл, который держим как object URL.
 useEffect(() => {
  roomMusicActions.clearPrivate();
  if (!room || !assetId || !trackId) return;
  if (track?.stream) {
   if (!engine.current) return;
   try {
    const stream = openRoomMusicStream(room, assetId, track.durationMs, engine.current, () =>
     roomMusicActions.setPrivateFailure('Не удалось продолжить поток Яндекс Музыки.')
    );
    roomMusicActions.setPrivateAudio({room, trackId, url: stream.url});
    return stream.close;
   } catch {
    roomMusicActions.setPrivateFailure('Этот клиент не поддерживает потоковое воспроизведение MP3.');
    return;
   }
  }
  let disposed = false,
   objectUrl: string | undefined;
  void musicService
   .file<{mime: string; base64: string}>({room, id: assetId})
   .then(file => {
    if (disposed) return;
    if (
     file.mime !== 'audio/mpeg' ||
     typeof file.base64 !== 'string' ||
     !file.base64 ||
     file.base64.length > 4 * Math.ceil(MAX_PRIVATE_AUDIO / 3)
    )
     throw new Error('Invalid media');
    const raw = atob(file.base64);
    if (raw.length > MAX_PRIVATE_AUDIO) throw new Error('Media too large');
    objectUrl = URL.createObjectURL(new Blob([Uint8Array.from(raw, c => c.charCodeAt(0))], {type: file.mime}));
    roomMusicActions.setPrivateAudio({room, trackId, url: objectUrl});
   })
   .catch(() => {
    if (!disposed) roomMusicActions.setPrivateFailure('Не удалось загрузить аудио этой комнаты.');
   });
  return () => {
   disposed = true;
   if (objectUrl) URL.revokeObjectURL(objectUrl);
  };
 }, [room, assetId, trackId, track?.stream, track?.durationMs, state.retry, engine]);

 // Опрос снапшота: без музыки реже, чтобы комната не платила за простой.
 useEffect(() => {
  const generation = ++epoch.current;
  roomMusicActions.reset(room);
  if (!room) return;
  let pending = false,
   timer = 0;
  function schedule(delay: number) {
   window.clearTimeout(timer);
   timer = window.setTimeout(() => {
    if (epoch.current === generation) void poll();
   }, delay);
  }
  async function poll() {
   if (pending || epoch.current !== generation) return;
   pending = true;
   const started = performance.now();
   let delay = 4000;
   try {
    const state = await musicService.state<MusicSnapshot>({room});
    if (epoch.current === generation) {
     roomMusicActions.pollSucceeded(state, started);
     if (state.track || state.status !== 'idle') delay = 2000;
    }
   } catch {
    if (epoch.current === generation) roomMusicActions.pollFailed();
   } finally {
    pending = false;
    if (epoch.current === generation) schedule(delay);
   }
  }
  void poll();
  return () => {
   epoch.current++;
   window.clearTimeout(timer);
  };
 }, [room]);

 useEffect(() => {
  const element = engine.current;
  if (element) {
   element.volume = state.volume / 100;
   element.muted = deaf;
  }
 }, [state.volume, deaf, engine]);

 useEffect(() => {
  const element = engine.current;
  if (element?.setSinkId) void element.setSinkId(speaker).catch(() => {});
 }, [speaker, engine]);

 // Позиция сверяется с сервером: при смене трека ставим её сразу, иначе догоняем плавно.
 useEffect(() => {
  const element = engine.current;
  if (!element) return;
  let active = true;
  const sync = () => {
   if (!current?.state.track || !playbackUrl) {
    element.pause();
    lastTrack.current = undefined;
    return;
   }
   const target = trackPosition(current, performance.now()) / 1000;
   if (element.readyState >= 1) {
    const changed = lastTrack.current !== current.state.track.id;
    lastTrack.current = current.state.track.id;
    if (changed || Math.abs(element.currentTime - target) > (element.paused ? 0.2 : 1.25)) element.currentTime = target;
   }
   if (current.state.status === 'playing' && element.paused)
    void element.play().then(
     () => {
      if (active) roomMusicActions.setBlocked(false);
     },
     () => {
      if (active) roomMusicActions.setBlocked(true);
     }
    );
   else if (current.state.status !== 'playing') {
    element.pause();
    roomMusicActions.setBlocked(false);
   }
  };
  sync();
  element.addEventListener('loadedmetadata', sync);
  return () => {
   active = false;
   element.removeEventListener('loadedmetadata', sync);
  };
 }, [current, playbackUrl, engine]);

 const enableAudio = () =>
  void engine.current?.play().then(
   () => roomMusicActions.setBlocked(false),
   () => roomMusicActions.setBlocked(true)
  );
 const queue = current?.state.queue ?? [];

 return {
  unavailable: state.unavailable,
  volume: state.volume,
  setVolume: roomMusicActions.setVolume,
  blocked: state.blocked,
  enableAudio,
  privateFailure: state.privateFailure,
  retryAudio: roomMusicActions.retryAudio,
  loadingPrivate: !!assetId && !playbackUrl && !state.privateFailure,
  playbackUrl,
  onAudioError: () => {
   if (playbackUrl) roomMusicActions.setBlocked(true);
  },
  track,
  playing: current?.state.status === 'playing',
  queue,
  elapsed: (now = performance.now()) => (current ? trackPosition(current, now) : 0),
  queuePage: (pageSize: number) => visibleQueue(queue, pageSize),
  hasMore: (pageSize: number) => hasMoreQueue(queue, pageSize),
  trackTime,
  statusText: (joined: boolean) =>
   trackStatusText({
    joined,
    unavailable: state.unavailable,
    hasTrack: !!track,
    playing: current?.state.status === 'playing'
   }),
  link: state.link,
  setLink: roomMusicActions.setLink,
  resetDraft: roomMusicActions.resetDraft,
  limit: state.limit,
  setLimit: roomMusicActions.setLimit,
  pending: state.pending,
  error: state.error,
  addDisabled: (joined: boolean) =>
   addDisabled({joined, unavailable: state.unavailable, pending: state.pending, hasLink: !!state.link.trim()}),
  run: (action: MusicCommand) => roomMusicActions.run({room, action}),
  command: (action: MusicCommand, url?: string, limit?: number) => roomMusicActions.command({room, action, url, limit}),
  addTrack: () => roomMusicActions.add(room)
 };
}

export type RoomMusicModel = ReturnType<typeof useRoomMusic>;
