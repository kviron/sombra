import {createStore} from 'zustand/vanilla';
import {DEFAULT_MEMBER_ROLE, getGroupRoles, groupService} from '@/entities/group';
import type {ChatState, Group, GroupPermission, GroupRole} from '@/shared/types';
import {
 canAssignRole,
 canTouchRole,
 conflictMessage,
 defaultRoleDraft,
 groupMembers,
 isConflictError,
 rolesOwner,
 rolesSupported,
 togglePermission,
 unsavedRoleWarning
} from './group-roles-rules';

export type RolesTab = 'roles' | 'members';
export type KickTarget = {id: string; name: string};

export type GroupRolesState = {
 tab: RolesTab;
 selected: string;
 name: string;
 permissions: GroupPermission[];
 dirty: boolean;
 error: string;
 busy: boolean;
 confirmDelete: boolean;
 confirmOff: boolean;
 kick: KickTarget | null;
};

const initialState: GroupRolesState = {
 tab: 'roles',
 selected: 'member',
 name: '',
 permissions: [],
 dirty: false,
 error: '',
 busy: false,
 confirmDelete: false,
 confirmOff: false,
 kick: null
};

export const groupRolesStore = createStore<GroupRolesState>(() => initialState);

/** Снимок данных, от которого зависит безопасность операции. */
export type RolesSnapshot = {
 chat: ChatState;
 group: Group;
 live: Group | undefined;
 owner: boolean;
 supported: boolean;
};

export type RunArgs = {
 op:
  'set_group_member_invites' | 'set_group_member_role' | 'kick_group_member' | 'delete_group_role' | 'save_group_role';
 data: Record<string, unknown>;
 snapshot: RolesSnapshot;
 refresh: () => Promise<ChatState> | Promise<void>;
 after?: () => void;
 ownerOnly?: boolean;
 onError?: (message: string) => void;
 onBusyChange?: (busy: boolean) => void;
 isAlive: () => boolean;
 isSameGroup: () => boolean;
};

const locks = new Set<string>();

export const groupRolesActions = {
 reset() {
  groupRolesStore.setState(initialState, true);
 },
 setTab(tab: RolesTab) {
  groupRolesStore.setState({tab});
 },
 setName(name: string) {
  groupRolesStore.setState({name, dirty: true});
 },
 setPermissions(permissions: GroupPermission[]) {
  groupRolesStore.setState({permissions, dirty: true});
 },
 toggle(permission: GroupPermission) {
  const {permissions} = groupRolesStore.getState();
  groupRolesStore.setState({permissions: togglePermission(permissions, permission), dirty: true});
 },
 setConfirmDelete(confirmDelete: boolean) {
  groupRolesStore.setState({confirmDelete});
 },
 setConfirmOff(confirmOff: boolean) {
  groupRolesStore.setState({confirmOff});
 },
 setKick(kick: KickTarget | null) {
  groupRolesStore.setState({kick});
 },
 /** После успешного сохранения черновик больше не отличается от сохранённого. */
 clearDirty() {
  groupRolesStore.setState({dirty: false});
 },
 /** Смена роли в списке: несохранённый черновик спрашивает подтверждение. */
 choose(value: string) {
  const {dirty} = groupRolesStore.getState();
  if (dirty && !window.confirm(unsavedRoleWarning)) return;
  groupRolesStore.setState({selected: value, dirty: false, confirmDelete: false, error: ''});
 },
 create() {
  const {dirty} = groupRolesStore.getState();
  if (dirty && !window.confirm(unsavedRoleWarning)) return;
  groupRolesStore.setState({selected: '__new', name: '', permissions: [], dirty: true, error: ''});
 },
 /** Черновик подтягивается из выбранной роли, пока пользователь его не менял. */
 syncDraft(role: GroupRole | undefined) {
  const {dirty, selected} = groupRolesStore.getState();
  if (dirty || selected === '__new') return;
  const draft = defaultRoleDraft(role, DEFAULT_MEMBER_ROLE.name);
  groupRolesStore.setState({name: draft.name, permissions: draft.permissions});
 },

 async run({
  op,
  data,
  snapshot,
  refresh,
  after,
  ownerOnly = true,
  onError,
  onBusyChange,
  isAlive,
  isSameGroup
 }: RunArgs) {
  if (locks.size || !snapshot.live || !snapshot.supported || (ownerOnly && !snapshot.owner)) return;
  if (op === 'set_group_member_invites' && typeof snapshot.group.membersCanInvite !== 'boolean') return;
  const roles = getGroupRoles(snapshot.group);
  if (
   op === 'set_group_member_role' &&
   !canAssignRole(snapshot.chat, snapshot.group, roles, String(data.user), String(data.role))
  )
   return;
  if ((op === 'delete_group_role' || op === 'save_group_role') && data.role && !canTouchRole(roles, String(data.role)))
   return;

  const groupId = snapshot.group.id;
  locks.add(op);
  groupRolesStore.setState({busy: true, error: ''});
  onBusyChange?.(true);
  const payload = {
   ...data,
   group: groupId,
   ...(op === 'kick_group_member' ? {} : {revision: snapshot.group.rolesRevision || 0})
  };
  try {
   if (op === 'set_group_member_invites') await groupService.setMemberInvites(payload);
   else if (op === 'set_group_member_role') await groupService.setMemberRole(payload);
   else if (op === 'kick_group_member') await groupService.kickMember(payload);
   else if (op === 'delete_group_role') await groupService.deleteRole(payload);
   else await groupService.saveRole(payload);
   await refresh();
   if (isAlive() && isSameGroup()) after?.();
  } catch (cause) {
   if (!isAlive() || !isSameGroup()) return;
   const raw = cause instanceof Error ? cause.message : String(cause);
   const conflict = isConflictError(raw);
   const message = conflict ? conflictMessage : raw;
   groupRolesStore.setState({error: message});
   onError?.(message);
   if (conflict) {
    try {
     await refresh();
    } catch {
     /* Оставляем понятный конфликт и черновик пользователя. */
    }
   }
  } finally {
   locks.delete(op);
   onBusyChange?.(false);
   if (isAlive() && isSameGroup()) groupRolesStore.setState({busy: false});
  }
 },

 /** Включение и выключение приглашений участников — отдельное правило с подтверждением. */
 async policy(enabled: boolean, rest: Omit<RunArgs, 'op' | 'data' | 'after' | 'ownerOnly'>) {
  await groupRolesActions.run({
   ...rest,
   op: 'set_group_member_invites',
   data: {enabled},
   after: () => groupRolesStore.setState({confirmOff: false})
  });
 }
};

export {groupMembers, rolesOwner, rolesSupported};
