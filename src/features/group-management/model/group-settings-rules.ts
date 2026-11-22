// Чистые правила настроек группы: черновик, права и готовность к сохранению.
// Сеть, DOM и React здесь не нужны, поэтому правила проверяются тестами.
import type {Group} from '@/shared/types';

export const permissionsChanged = 'Права изменились. Проверьте доступные действия.';
export const avatarPermissionsChanged = 'Права изменились. Изменение аватара недоступно.';

export type GroupDraft = {
 name: string;
 avatar: string;
 nameChanged: boolean;
 avatarChanged: boolean;
};

export type GroupRights = {member: boolean; rename: boolean; avatarAllowed: boolean};

/** Незаполненный черновик повторяет сохранённое значение живого снимка группы. */
export function groupDraft(current: Group, nameDraft: string | undefined, avatarDraft: string | undefined): GroupDraft {
 const name = nameDraft ?? current.name;
 const avatar = avatarDraft ?? current.avatar ?? '';
 return {name, avatar, nameChanged: name.trim() !== current.name, avatarChanged: avatar !== (current.avatar ?? '')};
}

export function groupNameValid(name: string) {
 const trimmed = name.trim();
 return !!trimmed && trimmed.length <= 60;
}

/** Сохранить можно изменённый черновик с именем до 60 символов и в рамках прав. */
export function canSaveGroup(draft: GroupDraft, rights: GroupRights) {
 return (
  groupNameValid(draft.name) &&
  (draft.nameChanged || draft.avatarChanged) &&
  (!draft.nameChanged || rights.rename) &&
  (!draft.avatarChanged || rights.avatarAllowed)
 );
}

/** Права проверяются заново в момент нажатия: с рендера они могли измениться. */
export function groupSaveProblem(draft: GroupDraft, rights: GroupRights) {
 if (!rights.member) return permissionsChanged;
 if (draft.nameChanged && !rights.rename) return permissionsChanged;
 if (draft.avatarChanged && !rights.avatarAllowed) return permissionsChanged;
 return '';
}

/** В запрос уходят только изменённые поля: остальные сервер не перезаписывает. */
export function groupUpdatePayload(group: string, draft: GroupDraft) {
 return {
  group,
  ...(draft.nameChanged ? {name: draft.name.trim()} : {}),
  ...(draft.avatarChanged ? {avatar: draft.avatar} : {})
 };
}

/** Аватар меняет только участник группы с правом на аватар. */
export function canChangeAvatar(rights: GroupRights) {
 return rights.member && rights.avatarAllowed;
}
