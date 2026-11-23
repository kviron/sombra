import {Bell, BookOpen, HardDrive, Mic, Monitor, RefreshCw, ShieldCheck, Sticker, UserRound} from 'lucide-react';
import type {AccountSection} from '../model/chat-panels';
import type {AccountMenuItem} from './account-sidebar';

/** Разделы окна настроек: список собирает страница, меню только показывает его. */
export const accountSections: readonly AccountMenuItem<AccountSection>[] = [
 {id: 'updates', label: 'Обновления', icon: RefreshCw},
 {id: 'voice', label: 'Голос и видео', icon: Mic},
 {id: 'notifications', label: 'Уведомления', icon: Bell},
 {id: 'storage', label: 'Данные и память', icon: HardDrive},
 {id: 'profile', label: 'Учётная запись', icon: UserRound},
 {id: 'security', label: 'Пароль и безопасность', icon: ShieldCheck},
 {id: 'sessions', label: 'Активные сеансы', icon: Monitor},
 {id: 'stickers', label: 'Стикеры', icon: Sticker},
 {id: 'journal', label: 'Журнал', icon: BookOpen}
];
