// Хранилище открытого профиля человека: заметка, отметка сохранения и украшения.
// Модель создаётся на открытое окно: два профиля одновременно не делят черновик заметки.
import {createStore} from 'zustand/vanilla';
import type {ProfileEffectTarget} from '@/shared/types';
import {effectErrorMessage, effectFeedbackText, noteKey} from './user-profile-rules';

export type EffectFeedback = {text: string; error?: boolean};

export type UserProfileState = {
 note: string;
 saved: boolean;
 applying: boolean;
 feedback: EffectFeedback | undefined;
};

const initialState: UserProfileState = {
 note: '',
 saved: false,
 applying: false,
 feedback: undefined
};

/** Заметка необязательна: недоступный localStorage не должен ломать профиль. */
function readNote(key: string) {
 try {
  return localStorage.getItem(key) ?? '';
 } catch {
  return '';
 }
}

function writeNote(key: string, value: string) {
 try {
  localStorage.setItem(key, value);
  return true;
 } catch {
  return false;
 }
}

export type EffectApplyArgs = {
 id: string;
 target: ProfileEffectTarget;
 apply: ((id: string, target: ProfileEffectTarget) => Promise<void>) | undefined;
 isAlive: () => boolean;
};

/** Одно окно профиля: заметка пишется сразу, украшение применяется через колбэк страницы. */
export function createUserProfileModel(me: string, user: string) {
 const key = noteKey(me, user);
 const store = createStore<UserProfileState>(() => ({...initialState, note: readNote(key)}));
 let applying = false;

 const actions = {
  setNote(note: string) {
   const saved = writeNote(key, note);
   store.setState(current => ({note, saved: saved || current.saved}));
  },
  clearSaved() {
   store.setState({saved: false});
  },

  /** Применение украшения: повторные нажатия блокируются, ответ не должен пережить закрытие окна. */
  async applyEffect({id, target, apply, isAlive}: EffectApplyArgs) {
   if (!apply || applying) return;
   applying = true;
   store.setState({applying: true, feedback: undefined});
   try {
    await apply(id, target);
    if (isAlive()) store.setState({feedback: {text: effectFeedbackText(target)}});
   } catch (reason) {
    if (isAlive()) store.setState({feedback: {text: effectErrorMessage(reason), error: true}});
   } finally {
    applying = false;
    if (isAlive()) store.setState({applying: false});
   }
  }
 };

 return {store, actions};
}

export type UserProfileStore = ReturnType<typeof createUserProfileModel>;
