import {useCallback, useEffect, useRef, useState} from 'react';
import {useStore} from 'zustand';
import type {ChatState, ProfileDecorationDoc, SessionDto, User} from '@/shared/types';
import type {PreparedProfileImage} from '@/shared/lib/image-crop';
import {sessionService} from '@/shared/api';
import {createAccountSecurityModel, type OperationGuards, type SessionGuards} from './account-security';
import type {MediaTarget} from './profile-decoration';

type Options = {
 state: ChatState | null;
 refresh: () => Promise<ChatState>;
 section: string;
 onMediaSaved: (user: User, field: MediaTarget | `decoration:${MediaTarget}`) => void;
};

/**
 * Единственное место, где живёт логика настроек: сеансы, профиль, картинки, пароль
 * и почта. Компонент получает готовые данные и колбэки.
 */
export function useAccountSecurity({state, refresh, section, onMediaSaved}: Options) {
 const [model] = useState(() =>
  createAccountSecurityModel({
   name: state?.me.name ?? '',
   bio: state?.me.bio ?? '',
   email: state?.email ?? ''
  })
 );
 const {actions} = model;
 const stored = useStore(model.store);
 const alive = useRef(true);
 const epoch = useRef(0);
 const identity = useRef(state?.me.id);
 identity.current = state?.me.id;
 const latest = useRef(state);
 latest.current = state;

 useEffect(() => {
  alive.current = true;
  return () => {
   alive.current = false;
  };
 }, []);

 // Другая учётная запись — новые поля формы и закрытые диалоги; ответы прошлой уже не нужны.
 useEffect(() => {
  epoch.current++;
  const current = latest.current;
  actions.resetAccount(current ? {name: current.me.name, bio: current.me.bio, email: current.email} : undefined);
 }, [actions, state?.me.id]);

 // Уход с раздела закрывает диалоги и стирает статус прошлого действия.
 useEffect(() => {
  actions.sectionChanged();
 }, [actions, section]);

 useEffect(() => {
  void actions.loadSessions(() => alive.current);
 }, [actions]);

 const sessionGuards = useCallback((): SessionGuards => {
  const account = identity.current;
  const token = sessionService.token();
  return {
   isAlive: () => alive.current,
   isSameAccount: (id: string) => identity.current === account && id === account,
   isCurrentSession: () => alive.current && identity.current === account && sessionService.token() === token
  };
 }, []);

 /** Начало операции формы: ответ прошлой операции перестаёт быть актуальным. */
 const operationGuards = useCallback((): OperationGuards => {
  const request = ++epoch.current;
  const guards = sessionGuards();
  return {...guards, isCurrentOperation: () => guards.isCurrentSession() && request === epoch.current};
 }, [sessionGuards]);

 const resetFields = useCallback(() => {
  const me = latest.current?.me;
  actions.resetFields(me ? {name: me.name, bio: me.bio} : undefined);
 }, [actions]);

 const cancelCrop = useCallback(() => {
  epoch.current++;
  actions.cancelCrop();
 }, [actions]);

 const saveIdentity = useCallback(
  () => void actions.saveIdentity({me: state?.me, refresh, begin: operationGuards}),
  [actions, operationGuards, refresh, state?.me]
 );

 const saveImage = useCallback(
  (kind: 'avatar' | 'cover', result?: PreparedProfileImage) =>
   actions.saveImage({
    kind,
    result,
    coverSupported: Boolean(state?.me.coverSupported),
    onSaved: onMediaSaved,
    begin: operationGuards
   }),
  [actions, onMediaSaved, operationGuards, state?.me.coverSupported]
 );

 const saveEffect = useCallback(
  (target: MediaTarget, decoration: ProfileDecorationDoc | null, id?: string) =>
   actions.saveEffect({target, decoration, id, onSaved: onMediaSaved, guard: sessionGuards}),
  [actions, onMediaSaved, sessionGuards]
 );

 const applyDecoration = useCallback(
  (target: MediaTarget, decoration: ProfileDecorationDoc | null) =>
   actions.applyDecoration({target, decoration, onSaved: onMediaSaved, guard: sessionGuards}),
  [actions, onMediaSaved, sessionGuards]
 );

 const changePassword = useCallback(
  (values: {current: unknown; password: unknown; confirm: unknown}) =>
   void actions.changePassword({...values, begin: operationGuards}),
  [actions, operationGuards]
 );

 const changeEmail = useCallback(
  (currentPassword: unknown) => actions.changeEmail({currentPassword, refresh, begin: operationGuards}),
  [actions, operationGuards, refresh]
 );

 const revokeSession = useCallback(
  (session: SessionDto) =>
   void actions.revokeSession({id: session.id, current: session.current, begin: operationGuards}),
  [actions, operationGuards]
 );

 const logoutAll = useCallback(() => void actions.logoutAll({begin: operationGuards}), [actions, operationGuards]);

 return {
  ...stored,
  coverSupported: Boolean(state?.me.coverSupported),
  actions: {
   setName: actions.setName,
   setBio: actions.setBio,
   setEmail: actions.setEmail,
   resetFields,
   saveIdentity,
   saveImage,
   cancelCrop,
   setCrop: actions.setCrop,
   openMedia: actions.openMedia,
   closeMedia: actions.closeMedia,
   openCatalog: actions.openCatalog,
   closeCatalog: actions.closeCatalog,
   saveEffect,
   applyDecoration,
   changePassword,
   changeEmail,
   revokeSession,
   logoutAll
  }
 };
}

export type AccountSecurityModel = ReturnType<typeof useAccountSecurity>;
