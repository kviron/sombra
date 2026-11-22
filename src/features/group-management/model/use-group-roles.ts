import {useCallback, useEffect, useMemo, useRef} from 'react';
import {useStore} from 'zustand';
import {canGroup, getGroupRoles} from '@/entities/group';
import type {ChatState, Group, GroupPermission} from '@/shared/types';
import {
 canKick,
 editableRole,
 groupMembers,
 policySupported as policySupportedRule,
 roleChoices,
 rolesOwner,
 rolesSupported as rolesSupportedRule
} from './group-roles-rules';
import {groupRolesActions, groupRolesStore, type RunArgs} from './group-roles';

type Options = {
 group: Group;
 state: ChatState;
 refresh: () => Promise<ChatState>;
 onError?: (message: string) => void;
 onBusyChange?: (busy: boolean) => void;
};

/**
 * Логика панели ролей: снимок группы, черновик роли, операции с ревизией и конфликтами.
 * Компонент получает готовые значения и колбэки.
 */
export function useGroupRoles({group, state, refresh, onError, onBusyChange}: Options) {
 const model = useStore(groupRolesStore);
 const alive = useRef(true);
 const live = state.groups.find(item => item.id === group.id);
 const current = live ?? group;
 const supported = rolesSupportedRule(current);
 const policySupported = policySupportedRule(current);
 const owner = rolesOwner(live, state) && supported;
 const roles = getGroupRoles(current);
 const role = roles.find(item => item.id === model.selected);
 const signature = JSON.stringify(role);
 const groupId = current.id;

 useEffect(() => {
  alive.current = true;
  return () => {
   alive.current = false;
  };
 }, []);

 // Другая группа — чистый черновик.
 useEffect(() => {
  groupRolesActions.reset();
 }, [groupId]);

 // Пока черновик не тронут, он повторяет выбранную роль.
 useEffect(() => {
  groupRolesActions.syncDraft(role);
 }, [signature]);

 const snapshot = {chat: state, group: current, live, owner, supported};
 const snapshotRef = useRef(snapshot);
 snapshotRef.current = snapshot;
 const refreshRef = useRef(refresh);
 refreshRef.current = refresh;

 const runArgs = useCallback(
  (): Omit<RunArgs, 'op' | 'data'> => ({
   snapshot: snapshotRef.current,
   refresh: () => refreshRef.current(),
   onError,
   onBusyChange,
   isAlive: () => alive.current,
   isSameGroup: () => snapshotRef.current.group.id === groupId
  }),
  [groupId, onBusyChange, onError]
 );

 const run = useCallback(
  (op: RunArgs['op'], data: Record<string, unknown>, after?: () => void, ownerOnly = true) =>
   groupRolesActions.run({...runArgs(), op, data, after, ownerOnly}),
  [runArgs]
 );

 const policy = useCallback((enabled: boolean) => groupRolesActions.policy(enabled, runArgs()), [runArgs]);

 return {
  tab: model.tab,
  setTab: groupRolesActions.setTab,
  selected: model.selected,
  choose: groupRolesActions.choose,
  create: groupRolesActions.create,
  name: model.name,
  setName: groupRolesActions.setName,
  permissions: model.permissions,
  setPermissions: (permissions: GroupPermission[]) => groupRolesActions.setPermissions(permissions),
  toggle: groupRolesActions.toggle,
  dirty: model.dirty,
  clearDirty: groupRolesActions.clearDirty,
  error: model.error,
  busy: model.busy,
  confirmDelete: model.confirmDelete,
  setConfirmDelete: groupRolesActions.setConfirmDelete,
  confirmOff: model.confirmOff,
  setConfirmOff: groupRolesActions.setConfirmOff,
  kick: model.kick,
  setKick: groupRolesActions.setKick,
  run,
  policy,
  current,
  live,
  supported,
  policySupported,
  owner,
  roles,
  role,
  roleOptions: useMemo(() => roleChoices(roles), [signature]),
  editable: editableRole(model.selected, role, owner),
  members: groupMembers(state, current),
  canKick: canKick(supported, !!live, canGroup(current, state.me.id, 'members.kick'))
 };
}

export type GroupRolesModel = ReturnType<typeof useGroupRoles>;
