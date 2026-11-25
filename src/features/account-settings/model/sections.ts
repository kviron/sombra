import {
 Bell,
 BookOpen,
 HardDrive,
 Mic,
 Monitor,
 Palette,
 RefreshCw,
 ShieldCheck,
 Sticker,
 UserRound,
 type LucideIcon
} from 'lucide-react';

/**
 * Раздел окна настроек: какие экраны существуют и как они называются в меню,
 * знает срез настроек аккаунта. Содержимое раздела собирает страница,
 * поэтому тип живёт здесь, а не в модели страницы.
 */
export type AccountSection =
 | 'profile'
 | 'security'
 | 'sessions'
 | 'voice'
 | 'updates'
 | 'stickers'
 | 'notifications'
 | 'storage'
 | 'journal'
 | 'appearance';

/** Пункт меню настроек: id, подпись и иконка. */
export type AccountMenuItem<T extends string = string> = {id: T; label: string; icon: LucideIcon};

/** Разделы окна настроек: список собирает срез, меню только показывает его. */
export const accountSections: readonly AccountMenuItem<AccountSection>[] = [
 {id: 'updates', label: 'Обновления', icon: RefreshCw},
 {id: 'voice', label: 'Голос и видео', icon: Mic},
 {id: 'appearance', label: 'Внешний вид', icon: Palette},
 {id: 'notifications', label: 'Уведомления', icon: Bell},
 {id: 'storage', label: 'Данные и память', icon: HardDrive},
 {id: 'profile', label: 'Учётная запись', icon: UserRound},
 {id: 'security', label: 'Пароль и безопасность', icon: ShieldCheck},
 {id: 'sessions', label: 'Активные сеансы', icon: Monitor},
 {id: 'stickers', label: 'Стикеры', icon: Sticker},
 {id: 'journal', label: 'Журнал', icon: BookOpen}
];
