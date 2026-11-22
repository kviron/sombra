import {createStore} from 'zustand/vanilla';
import {groupService} from '@/entities/group';
import type {Group} from '@/shared/types';
import type {PreparedProfileImage} from '@/shared/ui/image-crop-dialog';
import {
 avatarPermissionsChanged,
 canChangeAvatar,
 canSaveGroup,
 groupDraft,
 groupSaveProblem,
 groupUpdatePayload,
 type GroupDraft,
 type GroupRights
} from './group-settings-rules';

export type GroupSettingsSection = 'general' | 'roles';

export type GroupSettingsState = {
 section: GroupSettingsSection;
 nameDraft: string | undefined;
 avatarDraft: string | undefined;
 cropFile: File | undefined;
 busy: boolean;
 error: string;
 rolePending: boolean;
};

const initialState: GroupSettingsState = {
 section: 'general',
 nameDraft: undefined,
 avatarDraft: undefined,
 cropFile: undefined,
 busy: false,
 error: '',
 rolePending: false
};

/** Снимок группы и прав, от которого зависит безопасность операции. */
export type GroupSettingsSnapshot = {group: Group} & GroupRights;

/** Проверки «ответ ещё нужен»: диалог жив, группа и аккаунт не сменились. */
export type GroupSettingsGuards = {
 snapshot: () => GroupSettingsSnapshot;
 refresh: () => Promise<unknown>;
 onError: ((message: string) => void) | undefined;
 isAlive: () => boolean;
 isSameGroup: () => boolean;
};

/**
 * Хранилище открытых настроек группы: черновик названия и аватара, кроп и состояние
 * операции. Создаётся на один открытый диалог, поэтому черновик не переживает закрытие
 * и не показывается у другой группы.
 */
export function createGroupSettingsModel({section}: {section: GroupSettingsSection}) {
 const store = createStore<GroupSettingsState>(() => ({...initialState, section}));
 let lock = false;

 const valid = ({isAlive, isSameGroup}: GroupSettingsGuards) => isAlive() && isSameGroup();

 async function run(guards: GroupSettingsGuards, action: () => Promise<unknown>, after?: () => void) {
  if (lock) return false;
  lock = true;
  store.setState({busy: true, error: ''});
  try {
   await action();
   await guards.refresh();
   if (valid(guards)) after?.();
   return true;
  } catch (cause) {
   const message = cause instanceof Error ? cause.message : String(cause);
   if (guards.isAlive()) store.setState({error: message});
   guards.onError?.(message);
   try {
    await guards.refresh();
   } catch {
    /* Оставляем исходную ошибку и черновик пользователя. */
   }
   return false;
  } finally {
   lock = false;
   if (guards.isAlive()) store.setState({busy: false});
  }
 }

 const actions = {
  setSection(section: GroupSettingsSection) {
   store.setState({section});
  },
  setNameDraft(nameDraft: string) {
   store.setState({nameDraft});
  },
  /** Другая группа или другой аккаунт — чистый черновик; пустое состояние не трогаем. */
  resetDrafts() {
   const {nameDraft, avatarDraft, cropFile} = store.getState();
   if (nameDraft === undefined && avatarDraft === undefined && cropFile === undefined) return;
   store.setState({nameDraft: undefined, avatarDraft: undefined, cropFile: undefined});
  },
  /** «Удалить аватар» — черновик без картинки; сохранение отправит пустую строку. */
  removeAvatar(rights: GroupRights) {
   if (!canChangeAvatar(rights)) return;
   store.setState({avatarDraft: ''});
  },
  /** Выбранный файл становится кропом; без права на аватар окно не открывается. */
  upload(file: File, rights: GroupRights) {
   if (lock || !canChangeAvatar(rights)) return;
   store.setState({error: '', cropFile: file});
  },
  closeCrop() {
   store.setState({cropFile: undefined});
  },
  setRolePending(rolePending: boolean) {
   store.setState({rolePending});
  },
  /** Закрывать диалог нельзя, пока идёт операция или панель ролей занята. */
  isCloseBlocked() {
   return lock || store.getState().rolePending;
  },

  /** Кроп применён: аватар остаётся черновиком до сохранения. */
  applyAvatar(result: PreparedProfileImage, guards: GroupSettingsGuards) {
   if (!valid(guards) || !canChangeAvatar(guards.snapshot())) throw new Error(avatarPermissionsChanged);
   store.setState({avatarDraft: result.dataUrl, cropFile: undefined});
  },

  /** Сохранение: права и имя проверяются заново, поэтому устаревший рендер не отправит запрос. */
  async save(guards: GroupSettingsGuards) {
   const {nameDraft, avatarDraft} = store.getState();
   const snapshot = guards.snapshot();
   const draft: GroupDraft = groupDraft(snapshot.group, nameDraft, avatarDraft);
   const problem = groupSaveProblem(draft, snapshot);
   if (problem) {
    store.setState({error: problem});
    return false;
   }
   if (!canSaveGroup(draft, snapshot)) return false;
   return run(
    guards,
    () => groupService.update(groupUpdatePayload(snapshot.group.id, draft)),
    () => store.setState({nameDraft: undefined, avatarDraft: undefined})
   );
  }
 };

 return {store, actions};
}

export type GroupSettingsModel = ReturnType<typeof createGroupSettingsModel>;
