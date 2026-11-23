// Состояние диалога медиа профиля: сохранение рамки, удаление и сообщения об успехе.
import {createStore} from 'zustand/vanilla';
import type {ProfileDecorationDoc, ProfileEffectTarget} from '@/shared/types';
import {DECORATION_PRESETS, normalizeDecoration} from '@/shared/ui/avatar-fx';
import {decorationNotice, mediaError, removeNotice} from './profile-media-rules';

export type ProfileMediaOption = {key: string; title: string; doc: ProfileDecorationDoc | null};

const OPTIONS: Record<ProfileEffectTarget, ProfileMediaOption[]> = {
 avatar: [
  {key: 'none', title: 'Без рамки', doc: null},
  {
   key: 'ember-crown',
   title: 'Пламенный обод',
   doc: DECORATION_PRESETS['ember-crown'].decoration as ProfileDecorationDoc
  },
  {key: 'slime-pet', title: 'Слайм-питомец', doc: DECORATION_PRESETS['slime-pet'].decoration as ProfileDecorationDoc}
 ],
 cover: [
  {key: 'none', title: 'Без анимации', doc: null},
  {key: 'aurora-cover', title: 'Сияние', doc: DECORATION_PRESETS['aurora-cover'].decoration as ProfileDecorationDoc},
  {key: 'runner-cover', title: 'Бегун', doc: DECORATION_PRESETS['runner-cover'].decoration as ProfileDecorationDoc}
 ]
};

/** Варианты одной цели: пресет сравнивается с текущим украшением через движок. */
export function mediaOptions(target: ProfileEffectTarget): ProfileMediaOption[] {
 return OPTIONS[target];
}

/** Сервер и пресет описывают один вид по-разному, поэтому сравниваются нормализованные документы. */
export function isDecorationSelected(
 doc: ProfileDecorationDoc | null,
 frame: ProfileDecorationDoc | null,
 target: ProfileEffectTarget
): boolean {
 return (
  JSON.stringify(normalizeDecoration(doc, {target}).value) ===
  JSON.stringify(normalizeDecoration(frame, {target}).value)
 );
}

export type ProfileMediaState = {saving: boolean; error: string; notice: string};

export type SaveArgs = {
 busy: boolean;
 isAlive: () => boolean;
 onApply: (doc: ProfileDecorationDoc | null) => Promise<void>;
};

export type RemoveArgs = {busy: boolean; isAlive: () => boolean; onRemove: () => Promise<void>};

/**
 * Хранилище создаётся на открытый диалог: статус прошлой рамки или обложки не попадает
 * в следующее открытие, даже если родитель переиспользует компонент с другим ключом.
 */
export function createProfileMediaModel(target: ProfileEffectTarget) {
 const store = createStore<ProfileMediaState>(() => ({saving: false, error: '', notice: ''}));

 async function run(
  {busy, isAlive}: Pick<SaveArgs, 'busy' | 'isAlive'>,
  task: () => Promise<void>,
  success: string,
  fallback: string
 ) {
  if (store.getState().saving || busy) return;
  store.setState({saving: true, error: '', notice: ''});
  try {
   await task();
   if (isAlive()) store.setState({notice: success});
  } catch (reason) {
   if (isAlive()) store.setState({error: mediaError(reason, fallback)});
  } finally {
   if (isAlive()) store.setState({saving: false});
  }
 }

 const actions = {
  apply(doc: ProfileDecorationDoc | null, args: SaveArgs) {
   return run(args, () => args.onApply(doc), decorationNotice(target, doc), 'Не удалось сохранить оформление');
  },
  remove(args: RemoveArgs) {
   return run(args, args.onRemove, removeNotice(target), 'Не удалось удалить изображение');
  }
 };

 return {store, actions};
}

export type ProfileMediaModel = ReturnType<typeof createProfileMediaModel>;
