// Чистые правила профиля человека: даты, общие группы, дружба и украшения.
// Файл намеренно не импортирует ничего, кроме типов: так его читает node --experimental-strip-types.
import type {ProfileEffectTarget, Group, User} from '@/shared/types';
import type {FriendStatus} from '@/shared/lib/user-actions';

/** Заметка хранится локально; ключ привязан к паре «аккаунт + человек». */
export const noteKey = (me: string, user: string) => `sombra-profile-note:${me}:${user}`;

export const isSelf = (user: User, me: User) => user.id === me.id;

/** Общие группы: те, где состоят оба человека. */
export const sharedGroups = (groups: readonly Group[], userId: string) =>
 groups.filter(group => group.members.includes(userId));

/** Запись о дружбе — только для другого человека и не для бота. */
export function friendNote(status: FriendStatus, user: User, self: boolean) {
 if (self || user.bot) return null;
 if (status === 'friends') return 'friends' as const;
 if (status === 'outgoing') return 'outgoing' as const;
 if (status === 'incoming') return 'incoming' as const;
 return null;
}

/** Склонение счётчика участников в списке общих групп. */
export function participantWord(count: number) {
 if (count === 1) return 'участник';
 return count < 5 ? 'участника' : 'участников';
}

const dayFormat = new Intl.DateTimeFormat('ru', {day: 'numeric', month: 'long', year: 'numeric'});

export const formatDay = (timestamp: number) => dayFormat.format(timestamp * 1000);

/** «сегодня» важнее даты: так видно, когда человек был в сети в последний раз. */
export function formatMoment(timestamp: number) {
 const date = new Date(timestamp * 1000);
 const sameDay = date.toDateString() === new Date().toDateString();
 return sameDay
  ? `сегодня в ${date.toLocaleTimeString('ru', {hour: '2-digit', minute: '2-digit'})}`
  : `${date.toLocaleDateString('ru', {day: 'numeric', month: 'short'})} в ${date.toLocaleTimeString('ru', {hour: '2-digit', minute: '2-digit'})}`;
}

export const activityText = (user: User) =>
 user.online ? 'сейчас' : user.last_seen ? formatMoment(user.last_seen) : 'неизвестно';

export type EffectOffer = {target: ProfileEffectTarget; id: string; label: string; applied: boolean};

/** Поставить себе можно только публичное украшение другого человека и только не боту. */
export function effectOffers({user, me, enabled}: {user: User; me: User; enabled: boolean}): EffectOffer[] {
 if (!enabled || isSelf(user, me) || me.bot) return [];
 return (['avatar', 'cover'] as const).flatMap(target => {
  const id = user.decorationRefs?.[target];
  if (!id || !user.decorations?.[target]) return [];
  return [
   {
    target,
    id,
    label: target === 'avatar' ? 'Рамка аватара' : 'Эффект обложки',
    applied: me.decorationRefs?.[target] === id
   }
  ];
 });
}

export const effectFeedbackText = (target: ProfileEffectTarget) =>
 target === 'avatar' ? 'Рамка применена' : 'Эффект обложки применён';

export const effectErrorMessage = (reason: unknown) =>
 reason instanceof Error ? reason.message : 'Не удалось применить эффект';

export const noteSavedLabel = (saved: boolean) => (saved ? 'Сохранено' : 'Видна только вам');
