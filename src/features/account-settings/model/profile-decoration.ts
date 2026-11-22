// Состояние диалога украшения: каталог, черновик генерации, загрузка GIF и публикация.
import {createStore} from 'zustand/vanilla';
import type {
 ProfileDecorationDoc,
 ProfileEffect,
 ProfileEffectDraft,
 ProfileEffectScope,
 ProfileEffectTarget
} from '@/shared/types';
import {DECORATION_PRESETS, normalizeDecoration} from '@/shared/ui/avatar-fx';
import {PROFILE_EFFECT_MAX_BYTES} from '@/shared/ui/profile-effect-image';
import {accountService} from './services/account-service';
import {
 appendEffectPage,
 asChoice,
 draftResult,
 gifFileProblem,
 isDraftPending,
 isGifHeader,
 type DecorationChoice,
 type DecorationView,
 type EffectPage
} from './profile-decoration-rules';

export type {DecorationChoice, DecorationView, EffectPage};

export type MediaTarget = ProfileEffectTarget;

const OPTIONS = {
 avatar: [
  ['ember-crown', 'Огненная рамка'],
  ['slime-pet', 'Слайм в углу']
 ],
 cover: [
  ['runner-cover', 'Бегущий герой'],
  ['aurora-cover', 'Звёздное сияние']
 ]
} as const;

/** Готовые пресеты цели: их документы приходят из движка украшений. */
export function presetsFor(target: MediaTarget): DecorationChoice[] {
 return OPTIONS[target].map(([key, title]) => ({
  key,
  title,
  decoration: DECORATION_PRESETS[key].decoration as ProfileDecorationDoc
 }));
}

export type ProfileDecorationState = {
 view: DecorationView;
 file: File | undefined;
 title: string;
 preview: string;
 fileError: string;
 page: EffectPage;
 recentUploads: ProfileEffect[];
 pageLoading: boolean;
 pageError: string;
 reload: number;
 choice: DecorationChoice | undefined;
 busy: boolean;
 error: string;
 notice: string;
 prompt: string;
 draft: ProfileEffectDraft | undefined;
 pollError: string;
};

const initialState: ProfileDecorationState = {
 view: 'personal',
 file: undefined,
 title: '',
 preview: '',
 fileError: '',
 page: {items: [], nextOffset: null},
 recentUploads: [],
 pageLoading: false,
 pageError: '',
 reload: 0,
 choice: undefined,
 busy: false,
 error: '',
 notice: '',
 prompt: '',
 draft: undefined,
 pollError: ''
};

const message = (reason: unknown, fallback: string) => (reason instanceof Error ? reason.message : fallback);

/** Проверки «ответ ещё нужен»: компонент жив, область и сеанс не сменились. */
export type ScopeChecks = {isAlive: () => boolean; isCurrentScope: () => boolean};

/**
 * Хранилище создаётся на один открытый диалог: черновик, страница каталога и
 * черновик генерации не переживают закрытие и не мешают следующему украшению.
 */
export function createProfileDecorationModel({loading = false} = {}) {
 const store = createStore<ProfileDecorationState>(() => ({...initialState, pageLoading: loading}));

 const valid = ({isAlive, isCurrentScope}: ScopeChecks) => isAlive() && isCurrentScope();

 async function run(checks: ScopeChecks, task: (current: () => boolean) => Promise<void>) {
  if (store.getState().busy) return;
  store.setState({busy: true, error: '', notice: ''});
  try {
   await task(() => valid(checks));
  } catch (reason) {
   if (valid(checks)) store.setState({error: message(reason, 'Не удалось выполнить действие')});
  } finally {
   if (valid(checks)) store.setState({busy: false});
  }
 }

 const actions = {
  switchView(next: DecorationView, catalogSupported: boolean) {
   const {view, busy} = store.getState();
   if (next === view || busy) return;
   store.setState({
    view: next,
    choice: undefined,
    error: '',
    notice: '',
    page: {items: [], nextOffset: null},
    pageLoading: Boolean(catalogSupported && (next === 'personal' || next === 'catalog')),
    pageError: '',
    ...(view === 'upload' ? {file: undefined, preview: '', title: '', fileError: ''} : {})
   });
  },
  setFile(file: File | undefined) {
   store.setState({file});
  },
  setPreview(preview: string) {
   store.setState({preview});
  },
  setFileError(fileError: string) {
   store.setState({fileError});
  },
  chooseFile(candidate?: File) {
   store.setState({file: undefined, preview: '', fileError: '', error: ''});
   if (!candidate) return;
   const problem = gifFileProblem({size: candidate.size, type: candidate.type}, PROFILE_EFFECT_MAX_BYTES);
   if (problem) {
    store.setState({fileError: problem});
    return;
   }
   store.setState({file: candidate});
  },
  setTitle(title: string) {
   store.setState({title, error: ''});
  },
  setPrompt(prompt: string) {
   store.setState({prompt, draft: undefined, error: ''});
  },
  select(choice: DecorationChoice | undefined) {
   store.setState({choice, error: ''});
  },
  setPollError(pollError: string) {
   store.setState({pollError});
  },
  retry() {
   store.setState(state => ({reload: state.reload + 1}));
  },

  /** Страница каталога: первая заменяет список, повтор — по кнопке «Повторить». */
  async loadPage({view, target, ...checks}: ScopeChecks & {view: ProfileEffectScope; target: MediaTarget}) {
   store.setState({page: {items: [], nextOffset: null}, pageLoading: true, pageError: ''});
   try {
    const page = await accountService.listProfileEffects(view, target);
    if (valid(checks)) store.setState({page});
   } catch (reason) {
    if (valid(checks)) store.setState({pageError: message(reason, 'Не удалось загрузить эффекты')});
   } finally {
    if (valid(checks)) store.setState({pageLoading: false});
   }
  },

  async loadMore({
   target,
   catalogSupported,
   ...checks
  }: ScopeChecks & {target: MediaTarget; catalogSupported: boolean}) {
   const {view, page, busy} = store.getState();
   if (busy || !catalogSupported || (view !== 'personal' && view !== 'catalog') || page.nextOffset === null) return;
   const offset = page.nextOffset;
   await run(checks, async current => {
    const result = await accountService.listProfileEffects(view, target, offset);
    if (current()) store.setState(state => ({page: appendEffectPage(state.page, result)}));
   });
  },

  /** Фоновая проверка черновика: ошибка показывается отдельно от общего статуса. */
  async refreshDraft({id, ...checks}: ScopeChecks & {id: string}) {
   try {
    const draft = await accountService.getProfileEffectDraft(id);
    if (valid(checks)) store.setState({draft});
   } catch (reason) {
    if (valid(checks)) store.setState({pollError: message(reason, 'Не удалось проверить состояние черновика')});
   }
  },

  async upload({target, uploadsSupported, ...checks}: ScopeChecks & {target: MediaTarget; uploadsSupported: boolean}) {
   const {file, title, busy} = store.getState();
   if (busy || !uploadsSupported || !file || !title.trim()) return;
   await run(checks, async current => {
    if (!isGifHeader(await file.slice(0, 6).text())) throw new Error('Выберите файл GIF.');
    const data = await new Promise<string>((resolve, reject) => {
     const reader = new FileReader();
     reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
     reader.onerror = reader.onabort = () => reject(new Error('Не удалось прочитать GIF.'));
     reader.readAsDataURL(file);
    });
    if (!current()) return;
    const {item} = await accountService.uploadProfileEffect(target, title.trim(), data);
    if (!current()) return;
    store.setState(state => ({
     file: undefined,
     preview: '',
     title: '',
     fileError: '',
     recentUploads: [item, ...state.recentUploads],
     choice: asChoice(item),
     view: 'personal',
     notice: 'GIF добавлена в личную коллекцию. Чтобы использовать её, нажмите «Применить».'
    }));
   });
  },

  async generate({target, ...checks}: ScopeChecks & {target: MediaTarget}) {
   const {prompt, draft, busy} = store.getState();
   if (busy || isDraftPending(draft) || !prompt.trim()) return;
   await run(checks, async current => {
    const next = await accountService.createProfileEffectDraft(target, prompt.trim());
    if (current()) store.setState({pollError: '', draft: next});
   });
  },

  async saveDraft({target, ...checks}: ScopeChecks & {target: MediaTarget}) {
   const ready = draftResult(store.getState().draft, decoration =>
    Boolean(normalizeDecoration(decoration, {target}).value)
   );
   if (!ready) return;
   await run(checks, async current => {
    await accountService.createProfileEffect(target, ready.title, ready.decoration);
    if (!current()) return;
    store.setState({
     draft: undefined,
     prompt: '',
     view: 'personal',
     notice: 'Черновик сохранён в «Мои эффекты». Он не опубликован и не применён.'
    });
   });
  },

  /** Применение выбора: сохранение делает владелец среза, диалог только закрывается. */
  async apply({
   onSave,
   onClose,
   isCurrent: isCurrentChoice,
   ...checks
  }: ScopeChecks & {
   onSave: (doc: ProfileDecorationDoc | null, id?: string) => Promise<void>;
   onClose: () => void;
   isCurrent: (item: DecorationChoice) => boolean;
  }) {
   const {choice, busy} = store.getState();
   if (busy || !choice || isCurrentChoice(choice)) return;
   await run(checks, async current => {
    await onSave(choice.decoration, choice.id);
    if (current()) onClose();
   });
  },

  /** Публикация: в каталоге скрытая запись пропадает и страница перезагружается. */
  async changeVisibility(item: ProfileEffect, checks: ScopeChecks) {
   await run(checks, async current => {
    const {item: updated} = await accountService.setProfileEffectVisibility(item.id, !item.public);
    if (!current()) return;
    store.setState(state => ({
     recentUploads: state.recentUploads.map(row => (row.id === updated.id ? updated : row)),
     notice: updated.public ? 'Эффект опубликован в каталоге' : 'Эффект убран из каталога',
     ...(state.view === 'catalog' && !updated.public
      ? {choice: undefined, reload: state.reload + 1}
      : {page: {...state.page, items: state.page.items.map(row => (row.id === updated.id ? updated : row))}})
    }));
   });
  }
 };

 return {store, actions};
}
