import {useEffect, useRef, useState, type RefObject} from 'react';
import {useStore} from 'zustand';
import type {Group, ProfileEffectTarget, User} from '@/shared/types';
import {useUserActions} from '@/shared/lib/user-actions';
import {onlineText} from './chat-rules';
import {
 activityText,
 effectOffers,
 formatDay,
 formatMoment,
 friendNote,
 isSelf,
 noteSavedLabel,
 participantWord,
 sharedGroups
} from './user-profile-rules';
import {createUserProfileModel} from './user-profile';

type Options = {
 user: User;
 me: User;
 groups: Group[];
 onClose: () => void;
 onOpenGroup?: (id: string) => void;
 onApplyEffect?: (id: string, target: ProfileEffectTarget) => Promise<void>;
 restoreFocusRef?: RefObject<HTMLButtonElement | null>;
};

/**
 * Единственное место, где живёт логика профиля: заметка, применение украшения,
 * фокус в окне и вычисленные строки. Компонент получает данные и колбэки.
 */
export function useUserProfile({user, me, groups, onClose, onOpenGroup, onApplyEffect, restoreFocusRef}: Options) {
 const [model] = useState(() => createUserProfileModel(me.id, user.id));
 const state = useStore(model.store);
 const actions = useUserActions();
 const alive = useRef(true);
 const closeButton = useRef<HTMLButtonElement>(null);
 const close = useRef(onClose);
 close.current = onClose;
 const restoreRef = useRef(restoreFocusRef);
 restoreRef.current = restoreFocusRef;

 const self = isSelf(user, me);
 const status = self ? 'self' : (actions?.friendStatus(user.id) ?? 'none');
 const shared = sharedGroups(groups, user.id);
 const effects = effectOffers({user, me, enabled: !!onApplyEffect});
 const lastSeen = user.online || !user.last_seen ? '' : formatMoment(user.last_seen);

 useEffect(() => {
  alive.current = true;
  return () => {
   alive.current = false;
  };
 }, []);

 // Окно держит фокус: Escape закрывает, Tab ходит по кругу, закрытие возвращает фокус на место.
 useEffect(() => {
  const previous = document.activeElement as HTMLElement | null;
  closeButton.current?.focus();
  function onKeyDown(event: KeyboardEvent) {
   if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    close.current();
   }
   if (event.key === 'Tab') {
    const dialog = closeButton.current?.closest('[role="dialog"]');
    const items = Array.from(
     dialog?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input,textarea') ?? []
    ).filter(item => item.getClientRects().length);
    const first = items[0],
     last = items.at(-1);
    if (event.shiftKey && document.activeElement === first) {
     event.preventDefault();
     last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
     event.preventDefault();
     first?.focus();
    }
   }
  }
  window.addEventListener('keydown', onKeyDown, true);
  return () => {
   window.removeEventListener('keydown', onKeyDown, true);
   const target = restoreRef.current?.current ?? previous;
   if (target?.isConnected) target.focus();
  };
 }, []);

 // Отметка «Сохранено» гаснет сама: заметка пишется при каждом изменении.
 useEffect(() => {
  if (!state.saved) return;
  const timer = window.setTimeout(() => model.actions.clearSaved(), 1800);
  return () => window.clearTimeout(timer);
 }, [model.actions, state.saved]);

 function applyEffect(id: string, target: ProfileEffectTarget) {
  void model.actions.applyEffect({id, target, apply: onApplyEffect, isAlive: () => alive.current});
 }

 return {
  isSelf: self,
  status,
  statusText: onlineText(user.online),
  lastSeen,
  friendNote: friendNote(status, user, self),
  shared: shared.map(group => ({
   group,
   memberLabel: `${group.members.length} ${participantWord(group.members.length)}`
  })),
  effects,
  note: state.note,
  noteLabel: noteSavedLabel(state.saved),
  applying: state.applying,
  feedback: state.feedback,
  activityText: activityText(user),
  joinedText: formatDay(user.created_at),
  closeButton,
  actions: {
   setNote: model.actions.setNote,
   applyEffect,
   openGroup(id: string) {
    onOpenGroup?.(id);
    onClose();
   },
   message() {
    actions?.messageUser(user.id);
    onClose();
   },
   addFriend() {
    actions?.addFriend(user.id);
   },
   acceptFriend() {
    actions?.acceptFriend(user.id);
   },
   removeFriend() {
    actions?.removeFriend(user.id);
   },
   editOwnProfile() {
    onClose();
    actions?.editOwnProfile();
   }
  }
 };
}

export type UserProfileModel = ReturnType<typeof useUserProfile>;
