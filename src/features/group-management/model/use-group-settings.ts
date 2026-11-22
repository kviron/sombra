import {useCallback, useEffect, useRef, useState} from 'react';
import {useStore} from 'zustand';
import {canGroup} from '@/entities/group';
import type {ChatState, Group} from '@/shared/types';
import type {PreparedProfileImage} from '@/shared/ui/image-crop-dialog';
import {canSaveGroup, groupDraft, type GroupRights} from './group-settings-rules';
import {
 createGroupSettingsModel,
 type GroupSettingsGuards,
 type GroupSettingsSection,
 type GroupSettingsSnapshot
} from './group-settings';

type Options = {
 group: Group;
 state: ChatState;
 initialSection?: GroupSettingsSection;
 refresh: () => Promise<ChatState>;
 onError?: (message: string) => void;
};

/**
 * Единственное место, где живёт логика настроек группы: права на название и аватар,
 * черновик, кроп и сохранение. Компонент получает готовые данные и колбэки.
 */
export function useGroupSettings({group, state, initialSection = 'general', refresh, onError}: Options) {
 const [model] = useState(() => createGroupSettingsModel({section: initialSection}));
 const stored = useStore(model.store);
 const {actions} = model;
 const alive = useRef(true);
 const cropOrigin = useRef<HTMLInputElement | null>(null);
 const groupId = useRef(group.id);
 groupId.current = group.id;
 const scope = `${state.me.id}:${group.id}`;
 const live = state.groups.find(item => item.id === group.id);
 const current = live ?? group;
 const member = !!live && current.members.includes(state.me.id);
 const rename = member && canGroup(current, state.me.id, 'group.rename');
 const avatarAllowed = member && canGroup(current, state.me.id, 'group.avatar');
 const rights: GroupRights = {member, rename, avatarAllowed};
 const snapshot: GroupSettingsSnapshot = {group: current, member, rename, avatarAllowed};
 const snapshotRef = useRef(snapshot);
 snapshotRef.current = snapshot;
 const refreshRef = useRef(refresh);
 refreshRef.current = refresh;
 const onErrorRef = useRef(onError);
 onErrorRef.current = onError;

 useEffect(() => {
  alive.current = true;
  return () => {
   alive.current = false;
  };
 }, []);

 // Другая группа или другой аккаунт — чистый черновик.
 useEffect(() => {
  actions.resetDrafts();
 }, [actions, scope]);

 // Фокус возвращается в поле выбора файла, когда кроп закрылся.
 useEffect(() => {
  if (stored.cropFile || !cropOrigin.current) return;
  const target = cropOrigin.current;
  cropOrigin.current = null;
  const frame = requestAnimationFrame(() => {
   if (target.isConnected && !target.disabled && target.getClientRects().length) target.focus();
  });
  return () => cancelAnimationFrame(frame);
 }, [stored.cropFile]);

 const guards = useCallback(
  (): GroupSettingsGuards => ({
   snapshot: () => snapshotRef.current,
   refresh: () => refreshRef.current(),
   onError: onErrorRef.current,
   isAlive: () => alive.current,
   isSameGroup: () => snapshotRef.current.group.id === groupId.current
  }),
  []
 );

 const draft = groupDraft(current, stored.nameDraft, stored.avatarDraft);

 return {
  section: stored.section,
  current,
  member,
  rename,
  avatarAllowed,
  canManageStickers: member && canGroup(current, state.me.id, 'stickers.manage'),
  name: draft.name,
  avatar: draft.avatar,
  nameChanged: draft.nameChanged,
  avatarChanged: draft.avatarChanged,
  busy: stored.busy,
  rolePending: stored.rolePending,
  error: stored.error,
  cropFile: stored.cropFile,
  cropOrigin,
  canSave: canSaveGroup(draft, rights),
  isCloseBlocked: () => actions.isCloseBlocked(),
  actions: {
   setSection: actions.setSection,
   setNameDraft: actions.setNameDraft,
   removeAvatar: () => actions.removeAvatar(rights),
   openCrop: (file: File) => actions.upload(file, rights),
   closeCrop: actions.closeCrop,
   applyAvatar: (result: PreparedProfileImage) => actions.applyAvatar(result, guards()),
   save: () => void actions.save(guards()),
   setRolePending: actions.setRolePending
  }
 };
}

export type GroupSettingsModel = ReturnType<typeof useGroupSettings>;
