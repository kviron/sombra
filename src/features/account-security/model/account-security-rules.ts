// Чистые правила настроек безопасности: без сети и без DOM, поэтому проверяются тестами.
import type {SessionDto} from '@/shared/types';

/** Имя профиля: 2–32 символа после обрезки; пустая строка — ошибки нет. */
export function nameProblem(name: string): string {
 const trimmed = name.trim();
 return trimmed.length < 2 || trimmed.length > 32 ? 'Имя: 2–32 символа' : '';
}

/** Профиль не менялся — сохранять нечего. */
export function identityUnchanged(name: string, bio: string, me: {name: string; bio: string} | undefined): boolean {
 return Boolean(me) && name.trim() === me?.name && bio === me?.bio;
}

/** Пароль и подтверждение приходят из формы как есть, поэтому сравниваются без приведения типа. */
export function passwordProblem(password: unknown, confirm: unknown): string {
 return password === confirm ? '' : 'Пароли не совпадают';
}

/** Обложка доступна только после обновления сервера. */
export function coverProblem(coverSupported: boolean): string {
 return coverSupported ? '' : 'Для обложек требуется обновление сервера';
}

/** Подпись устройства: текущий сеанс важнее названия платформы. */
export function sessionTitle(session: SessionDto): string {
 if (session.current) return 'Это устройство';
 if (session.device.includes('Windows')) return 'Windows';
 if (session.device.includes('Mac')) return 'Mac';
 return 'Браузер / приложение';
}

export function deviceLabel(device: string): string {
 return device.slice(0, 70);
}

export function lastSeenLabel(seconds: number): string {
 return new Date(seconds * 1000).toLocaleString('ru');
}

/** Текст уведомления после сохранения или удаления картинки профиля. */
export function mediaNotice(kind: 'avatar' | 'cover', removed: boolean): string {
 if (kind === 'cover') return removed ? 'Обложка удалена' : 'Обложка сохранена';
 return removed ? 'Аватарка удалена' : 'Аватарка сохранена';
}

/** Почта не изменилась — кнопка сохранения неактивна; без данных аккаунта сравнение невозможно. */
export function emailUnchanged(email: string, current: string | undefined): boolean {
 return current !== undefined && email.trim().toLowerCase() === current;
}
