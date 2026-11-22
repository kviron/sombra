import {api} from '@/shared/api';
import type {
 ChatPreferences,
 ProfileDecorationDoc,
 ProfileEffect,
 ProfileEffectAsset,
 ProfileEffectDraft,
 ProfileEffectScope,
 ProfileEffectTarget,
 User
} from '@/shared/api/backend';

/** Аккаунт: почта, пароль, уведомления и украшения профиля. */
export const accountService = {
 changePassword: (payload: Record<string, unknown>) => api.auth.changePassword(payload),
 changeEmail: (payload: Record<string, unknown>) => api.auth.changeEmail(payload),
 setNotificationPreferences: <T = ChatPreferences>(payload: Record<string, unknown>) =>
  api.notifications.setPreferences<T>(payload),
 uploadProfileEffect: <T = {item: ProfileEffect}>(target: ProfileEffectTarget, title: string, data: string) =>
  api.profileEffect.upload<T>({target, title, data}),
 profileEffectFile: <T = {asset: ProfileEffectAsset; data: string}>(id: string) => api.profileEffect.file<T>({id}),
 listProfileEffects: <T = {items: ProfileEffect[]; nextOffset: number | null}>(
  scope: ProfileEffectScope,
  target: ProfileEffectTarget,
  offset = 0
 ) => api.profileEffect.list<T>({scope, target, offset, limit: 12}),
 createProfileEffect: <T = {item: ProfileEffect}>(
  target: ProfileEffectTarget,
  title: string,
  decoration: ProfileDecorationDoc
 ) => api.profileEffect.create<T>({target, title, decoration}),
 applyProfileEffect: <T = {item: ProfileEffect; user: User}>(id: string) => api.profileEffect.apply<T>({id}),
 setProfileEffectVisibility: <T = {item: ProfileEffect}>(id: string, isPublic: boolean) =>
  isPublic ? api.profileEffect.publish<T>({id}) : api.profileEffect.unpublish<T>({id}),
 createProfileEffectDraft: <T = ProfileEffectDraft>(target: ProfileEffectTarget, prompt: string) =>
  api.profileEffect.createDraft<T>({target, prompt}),
 getProfileEffectDraft: <T = ProfileEffectDraft>(id: string) => api.profileEffect.getDraft<T>({id})
};
