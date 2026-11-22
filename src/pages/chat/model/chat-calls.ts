// Звонки в переписке: какой звонок показать в открытом чате и громкость участников звонка.
// Порядок опроса звонков остаётся в `useDialogCalls` среза voice-room; здесь только решения страницы.
import {createStore} from 'zustand/vanilla';
import {dialogCallFor, voiceRoomOf} from './chat-rules';

export {dialogCallFor, voiceRoomOf};

/** Громкость участника хранится на аккаунт и пользователя, а не на комнату. */
export const participantVolumeKey = (account: string, id: string) => `sombra-participant-volume:${account}:${id}`;

/** Сохранённая громкость: испорченное значение и недоступное хранилище дают значение по умолчанию. */
export function storedParticipantVolume(key: string) {
 try {
  const stored = localStorage.getItem(key);
  if (stored === null) return undefined;
  const value = Number(stored);
  if (Number.isFinite(value) && value >= 0 && value <= 200) return value;
 } catch {
  /* Недоступное хранилище не должно ломать воспроизведение. */
 }
 return undefined;
}

export type ParticipantVolumesState = {volumes: Record<string, number>};

const initialState: ParticipantVolumesState = {volumes: {}};

export const participantVolumesStore = createStore<ParticipantVolumesState>(() => initialState);

export const participantVolumesActions = {
 reset() {
  participantVolumesStore.setState(initialState, true);
 },
 set(key: string, volume: number) {
  participantVolumesStore.setState(current => ({volumes: {...current.volumes, [key]: volume}}));
  try {
   localStorage.setItem(key, String(volume));
  } catch {
   /* Недоступное хранилище не должно ломать ползунок. */
  }
 }
};

/** Громкость участника: себя и неизвестных считаем за 100%. */
export function participantVolume(account: string, id: string, volumes: Record<string, number>) {
 if (!account || !id || id === account) return 100;
 const key = participantVolumeKey(account, id);
 return volumes[key] ?? storedParticipantVolume(key) ?? 100;
}
