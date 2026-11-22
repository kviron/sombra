import {createStore} from 'zustand/vanilla';
import {parseMusicLimit} from '@/shared/lib/music-command';
import {musicService} from './services/music-service';
import {
 commandFailureMessage,
 commandProblem,
 isFreshSnapshot,
 receivedAt,
 type MusicCommand,
 type MusicReading,
 type MusicSnapshot,
 type PrivateAudio
} from './room-music-rules';

/** Музыка комнаты: снапшот эфира, звук трека, громкость и черновик команды. */
export type RoomMusicState = {
 room: string | undefined;
 reading: MusicReading | null;
 volume: number;
 blocked: boolean;
 unavailable: boolean;
 privateAudio: PrivateAudio | undefined;
 privateFailure: string;
 retry: number;
 link: string;
 limit: string;
 pending: boolean;
 error: string;
};

const initialState: RoomMusicState = {
 room: undefined,
 reading: null,
 volume: 65,
 blocked: false,
 unavailable: false,
 privateAudio: undefined,
 privateFailure: '',
 retry: 0,
 link: '',
 limit: '32',
 pending: false,
 error: ''
};

export const roomMusicStore = createStore<RoomMusicState>(() => initialState);

type RunArgs = {room: string | undefined; action: MusicCommand; url?: string; limit?: number};

export const roomMusicActions = {
 /** Другая комната или выход: снапшот и черновик к ней не относятся, громкость остаётся общей. */
 reset(room: string | undefined) {
  roomMusicStore.setState({
   room,
   reading: null,
   blocked: false,
   unavailable: false,
   link: '',
   limit: '32',
   pending: false,
   error: ''
  });
 },

 /** Снапшот принят, если он не старше показанного. */
 accept(state: MusicSnapshot, started: number) {
  const now = performance.now();
  roomMusicStore.setState(previous =>
   isFreshSnapshot(previous.reading, state) ? {reading: {state, received: receivedAt(started, now)}} : previous
  );
 },

 pollFailed() {
  roomMusicStore.setState({reading: null, unavailable: true});
 },
 pollSucceeded(state: MusicSnapshot, started: number) {
  // Ответ на команду из прошлой комнаты не должен менять состояние новой.
  if (state.room !== roomMusicStore.getState().room) return;
  roomMusicActions.accept(state, started);
  roomMusicStore.setState({unavailable: false});
 },

 setVolume(volume: number) {
  roomMusicStore.setState({volume});
 },
 /** Черновик и ошибка относятся к открытой панели: при повторном открытии они пустые. */
 resetDraft() {
  roomMusicStore.setState({link: '', limit: '32', pending: false, error: ''});
 },
 setBlocked(blocked: boolean) {
  roomMusicStore.setState({blocked});
 },
 setLink(link: string) {
  roomMusicStore.setState({link});
 },
 setLimit(limit: string) {
  roomMusicStore.setState({limit});
 },
 clearPrivate() {
  roomMusicStore.setState({privateAudio: undefined, privateFailure: ''});
 },
 setPrivateAudio(privateAudio: PrivateAudio) {
  roomMusicStore.setState({privateAudio});
 },
 setPrivateFailure(privateFailure: string) {
  roomMusicStore.setState({privateFailure});
 },
 retryAudio() {
  roomMusicStore.setState(previous => ({retry: previous.retry + 1}));
 },

 /**
  * Команда музыки: проверка аргументов, запрос и перевод ошибки живут здесь.
  * Ошибки она бросает наружу — так команду из строки ввода показывает общий обработчик страницы.
  */
 async command({room, action, url, limit}: RunArgs) {
  const problem = commandProblem({room, action, url, limit});
  if (problem) throw new Error(problem);
  const started = performance.now();
  try {
   const state = await musicService.command<MusicSnapshot>({
    room,
    action,
    ...(url ? {url} : {}),
    ...(limit !== undefined ? {limit} : {})
   });
   roomMusicActions.pollSucceeded(state, started);
  } catch (reason) {
   throw new Error(commandFailureMessage(reason), {cause: reason});
  }
 },

 /** Команда из панели: признак работы и текст ошибки показывает сама панель. */
 async run(args: RunArgs) {
  const {pending} = roomMusicStore.getState();
  if (pending) return false;
  roomMusicStore.setState({pending: true, error: ''});
  try {
   await roomMusicActions.command(args);
   if (args.action === 'add') roomMusicStore.setState({link: ''});
   return true;
  } catch (reason) {
   roomMusicStore.setState({
    error: reason instanceof Error ? reason.message : commandFailureMessage(reason)
   });
   return false;
  } finally {
   roomMusicStore.setState({pending: false});
  }
 },

 /** Добавление трека берёт ссылку и лимит из черновика; пустая ссылка не считается ошибкой. */
 async add(room: string | undefined) {
  const {link, limit} = roomMusicStore.getState();
  const url = link.trim();
  if (!url) return false;
  return roomMusicActions.run({room, action: 'add', url, limit: parseMusicLimit(limit)});
 }
};
