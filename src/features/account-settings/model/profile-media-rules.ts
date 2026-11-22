// Чистые правила диалога аватара и обложки: подписи, наличие картинки и текст результата.
import type {ProfileDecorationDoc, User} from '@/shared/types';
import type {MediaTarget} from './profile-decoration';

export function mediaTitle(target: MediaTarget): string {
 return target === 'avatar' ? 'Аватар профиля' : 'Обложка профиля';
}

export function mediaDescription(target: MediaTarget): string {
 return target === 'avatar'
  ? 'Квадратная картинка и рамка вокруг неё.'
  : 'Широкая картинка за аватаром и анимация поверх неё.';
}

export function mediaHasImage(user: Pick<User, 'avatar' | 'cover'>, target: MediaTarget): boolean {
 return target === 'avatar' ? !!user.avatar : !!user.cover;
}

export function mediaFrame(user: Pick<User, 'decorations'>, target: MediaTarget): ProfileDecorationDoc | null {
 return user.decorations?.[target] ?? null;
}

/** Что написать после сохранения рамки или анимации. */
export function decorationNotice(target: MediaTarget, doc: ProfileDecorationDoc | null): string {
 if (target === 'avatar') return doc ? 'Рамка обновлена' : 'Рамка убрана';
 return doc ? 'Анимация обновлена' : 'Анимация убрана';
}

export function removeNotice(target: MediaTarget): string {
 return target === 'avatar' ? 'Аватар удалён' : 'Обложка удалена';
}

/** Ошибка действия: сообщение сервера важнее подписи диалога. */
export function mediaError(reason: unknown, fallback: string): string {
 return reason instanceof Error ? reason.message : fallback;
}
