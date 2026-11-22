// Состояние настроек безопасности: профиль, картинки, пароль, почта и активные сеансы.
import {createStore} from 'zustand/vanilla';
import type {ProfileDecorationDoc, SessionDto, User} from '@/shared/types';
import type {PreparedProfileImage} from '@/shared/lib/image-crop';
import {sessionService} from '@/shared/api';
import {userService} from '@/entities/user';
import {accountService} from './services/account-service';
import {coverProblem, identityUnchanged, mediaNotice, nameProblem, passwordProblem} from './account-security-rules';
import type {MediaTarget} from './profile-decoration';

export type CropDraft = {file: File; kind: 'avatar' | 'cover'};

export type AccountSecurityState = {
 sessions: SessionDto[];
 busy: boolean;
 error: string;
 notice: string;
 name: string;
 bio: string;
 email: string;
 crop: CropDraft | undefined;
 media: MediaTarget | undefined;
 effects: MediaTarget | undefined;
};

const initialState: AccountSecurityState = {
 sessions: [],
 busy: false,
 error: '',
 notice: '',
 name: '',
 bio: '',
 email: '',
 crop: undefined,
 media: undefined,
 effects: undefined
};

const message = (reason: unknown, fallback = 'Не удалось выполнить действие') =>
 reason instanceof Error ? reason.message : fallback;

/** Проверки «ответ ещё принадлежит этому аккаунту и сеансу». */
export type SessionGuards = {
 isAlive: () => boolean;
 isSameAccount: (id: string) => boolean;
 isCurrentSession: () => boolean;
};

/** Операция формы: её ответ ценен, только пока не начата следующая. */
export type OperationGuards = SessionGuards & {isCurrentOperation: () => boolean};

/**
 * Хранилище создаётся на открытые настройки: черновик имени, почты и диалоги
 * принадлежат экземпляру, а не всему приложению.
 */
export function createAccountSecurityModel(initial: {name: string; bio: string; email: string}) {
 const store = createStore<AccountSecurityState>(() => ({...initialState, ...initial}));

 async function loadSessions(isAlive: () => boolean) {
  try {
   const sessions = await userService.sessions<SessionDto[]>();
   if (isAlive()) store.setState({sessions});
  } catch (reason) {
   if (isAlive()) store.setState({error: message(reason)});
  }
 }

 async function run(begin: () => OperationGuards, task: (guards: OperationGuards) => Promise<void>): Promise<boolean> {
  if (store.getState().busy) return false;
  const guards = begin();
  store.setState({busy: true, error: '', notice: ''});
  try {
   await task(guards);
   return true;
  } catch (reason) {
   if (guards.isCurrentOperation()) store.setState({error: message(reason)});
   return false;
  } finally {
   if (guards.isCurrentOperation()) store.setState({busy: false});
  }
 }

 const actions = {
  setName(name: string) {
   store.setState({name});
  },
  setBio(bio: string) {
   store.setState({bio});
  },
  setEmail(email: string) {
   store.setState({email});
  },
  /** Escape в поле имени возвращает подписи профиля, но не трогает диалоги. */
  resetFields(profile?: {name: string; bio: string}) {
   store.setState({name: profile?.name ?? '', bio: profile?.bio ?? ''});
  },
  /** Другая учётная запись — чистые поля формы и закрытые диалоги. */
  resetAccount(profile?: {name: string; bio: string; email: string}) {
   const {sessions} = store.getState();
   store.setState({...initialState, sessions, ...(profile ?? {})});
  },
  sectionChanged() {
   store.setState({crop: undefined, media: undefined, effects: undefined, error: '', notice: ''});
  },
  setCrop(crop: CropDraft | undefined) {
   store.setState({crop});
  },
  cancelCrop() {
   store.setState({crop: undefined, busy: false});
  },
  openMedia(media: MediaTarget) {
   store.setState({media});
  },
  closeMedia() {
   store.setState({media: undefined});
  },
  openCatalog(effects: MediaTarget) {
   store.setState({effects});
  },
  closeCatalog() {
   store.setState({effects: undefined});
  },
  loadSessions,

  /** Имя и описание: проверка длины и «ничего не изменилось» — правило продукта. */
  async saveIdentity({
   me,
   refresh,
   begin
  }: {
   me: {name: string; bio: string} | undefined;
   refresh: () => Promise<unknown>;
   begin: () => OperationGuards;
  }) {
   const {name, bio} = store.getState();
   const problem = nameProblem(name);
   if (problem) {
    store.setState({error: problem});
    return;
   }
   if (identityUnchanged(name, bio, me)) return;
   await run(begin, async () => {
    await userService.updateProfile({profile: {name: name.trim(), bio}});
    await refresh();
    store.setState({notice: 'Профиль сохранён'});
   });
  },

  async changePassword({
   current,
   password,
   confirm,
   begin
  }: {
   current: unknown;
   password: unknown;
   confirm: unknown;
   begin: () => OperationGuards;
  }) {
   const problem = passwordProblem(password, confirm);
   if (problem) {
    store.setState({error: problem});
    return;
   }
   await run(begin, async () => {
    await accountService.changePassword({current_password: current, password});
    sessionService.clear();
   });
  },

  /** Почта меняется вместе с текущим паролем; форма сбрасывается только после успеха. */
  async changeEmail({
   currentPassword,
   refresh,
   begin
  }: {
   currentPassword: unknown;
   refresh: () => Promise<unknown>;
   begin: () => OperationGuards;
  }): Promise<boolean> {
   const {email} = store.getState();
   return run(begin, async () => {
    await accountService.changeEmail({email, current_password: currentPassword});
    await refresh();
    store.setState({notice: 'Почта изменена. Используйте её при следующем входе.'});
   });
  },

  /**
   * Аватар и обложка: сначала читается текущий профиль, чтобы не затереть имя и
   * описание, затем картинка сохраняется и отдаётся владельцу среза.
   */
  async saveImage({
   kind,
   result,
   coverSupported,
   onSaved,
   begin
  }: {
   kind: 'avatar' | 'cover';
   result?: PreparedProfileImage;
   coverSupported: boolean;
   onSaved: (user: User, field: MediaTarget) => void;
   begin: () => OperationGuards;
  }) {
   if (store.getState().busy) throw new Error('Дождитесь сохранения');
   const problem = kind === 'cover' ? coverProblem(coverSupported) : '';
   if (problem) throw new Error(problem);
   const guards = begin();
   store.setState({busy: true, error: '', notice: ''});
   try {
    let saved: User;
    if (kind === 'cover')
     ({user: saved} = await userService.setCover<{user: User}>({
      cover: result ? {dataUrl: result.dataUrl, crop: result.crop} : null
     }));
    else {
     const {user} = await userService.me<{user: User}>();
     if (!guards.isCurrentOperation() || !guards.isSameAccount(user.id)) throw new Error('Учётная запись изменилась');
     await userService.updateProfile({profile: {name: user.name, bio: user.bio, avatar: result?.dataUrl ?? ''}});
     saved = {...user, avatar: result?.dataUrl ?? ''};
    }
    if (!guards.isCurrentOperation() || !guards.isSameAccount(saved.id)) return;
    onSaved(saved, kind);
    store.setState({crop: undefined, notice: mediaNotice(kind, !result)});
   } catch (reason) {
    if (guards.isCurrentOperation()) store.setState({error: message(reason)});
    throw reason;
   } finally {
    if (guards.isCurrentOperation()) store.setState({busy: false});
   }
  },

  /** Украшение из каталога применяется владельцем среза; ошибка уходит в диалог. */
  async saveEffect({
   target,
   decoration,
   id,
   onSaved,
   guard
  }: {
   target: MediaTarget;
   decoration: ProfileDecorationDoc | null;
   id?: string;
   onSaved: (user: User, field: `decoration:${MediaTarget}`) => void;
   guard: () => SessionGuards;
  }) {
   const guards = guard();
   const {user} = await (id
    ? accountService.applyProfileEffect(id)
    : userService.setDecoration<{user: User}>({target, decoration}));
   if (!guards.isAlive() || !guards.isSameAccount(user.id) || !guards.isCurrentSession()) return;
   onSaved(user, `decoration:${target}`);
   store.setState({
    error: '',
    notice: id || decoration ? 'Украшение сохранено' : 'Украшение убрано'
   });
  },

  /** Рамка из диалога медиа: при смене аккаунта диалог должен показать ошибку. */
  async applyDecoration({
   target,
   decoration,
   onSaved,
   guard
  }: {
   target: MediaTarget;
   decoration: ProfileDecorationDoc | null;
   onSaved: (user: User, field: `decoration:${MediaTarget}`) => void;
   guard: () => SessionGuards;
  }) {
   const guards = guard();
   const {user} = await userService.setDecoration<{user: User}>({target, decoration});
   if (!guards.isAlive() || !guards.isSameAccount(user.id) || !guards.isCurrentSession())
    throw new Error('Учётная запись изменилась');
   onSaved(user, `decoration:${target}`);
  },

  async revokeSession({id, current, begin}: {id: string; current: boolean; begin: () => OperationGuards}) {
   await run(begin, async guards => {
    await userService.revokeSession(id);
    if (current) sessionService.clear();
    else await loadSessions(guards.isAlive);
   });
  },

  async logoutAll({begin}: {begin: () => OperationGuards}) {
   await run(begin, async () => {
    await userService.logoutAll();
    sessionService.clear();
   });
  }
 };

 return {store, actions};
}

export type AccountSecurityModel = ReturnType<typeof createAccountSecurityModel>;
