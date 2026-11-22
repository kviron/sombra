// Чистые правила управления ролями группы: без сети, DOM и импортов слоёв — поэтому проверяются тестами.
import type {ChatState, Group, GroupPermission, GroupRole} from '@/shared/types';

export const RESERVED_ROLES = new Set(['member', 'owner']);

export function rolesSupported(group: Group) {
 return Array.isArray(group.roles) && typeof group.rolesRevision === 'number';
}

export function policySupported(group: Group) {
 return rolesSupported(group) && typeof group.membersCanInvite === 'boolean';
}

/** Владелец и участник — по живому снимку группы, а не по копии из пропсов. */
export function rolesOwner(live: Group | undefined, chat: ChatState) {
 return !!live && live.owner === chat.me.id && live.members.includes(chat.me.id);
}

export function editableRole(selected: string, role: GroupRole | undefined, owner: boolean) {
 return owner && selected !== 'member' && selected !== 'owner' && (selected === '__new' || !!role);
}

export function groupMembers(chat: ChatState, group: Group) {
 return chat.users.filter(user => group.members.includes(user.id));
}

export function roleChoices(roles: GroupRole[]) {
 return roles.map(item => ({value: item.id, label: item.name}));
}

export function defaultRoleDraft(role: GroupRole | undefined, memberName: string) {
 return {name: role?.name ?? memberName, permissions: role?.permissions ?? []};
}

export function togglePermission(permissions: GroupPermission[], permission: GroupPermission) {
 return permissions.includes(permission)
  ? permissions.filter(item => item !== permission)
  : [...permissions, permission];
}

/** Право выгонять участников: роли поддержаны, группа жива и есть право `members.kick`. */
export function canKick(supported: boolean, live: boolean, hasPermission: boolean) {
 return supported && live && hasPermission;
}

/** Можно ли назначить роль этому участнику: не бот, не владелец, есть в группе и роль существует. */
export function canAssignRole(chat: ChatState, group: Group, roles: GroupRole[], userId: string, roleId: string) {
 const target = chat.users.find(user => user.id === userId);
 return (
  !!target &&
  !target.bot &&
  target.id !== group.owner &&
  group.members.includes(target.id) &&
  roles.some(role => role.id === roleId)
 );
}

export function canTouchRole(roles: GroupRole[], roleId: string) {
 return roles.some(role => role.id === roleId && !RESERVED_ROLES.has(role.id));
}

export const isConflictError = (raw: string) => /revision|conflict|верси|изменен|изменён/i.test(raw);

export const conflictMessage =
 'Роли уже изменены другим запросом. Данные обновлены; ваши изменения сохранены в форме. Проверьте их и повторите сохранение.';

export const unsavedRoleWarning = 'Отменить несохранённые изменения роли?';
