export const ACCENTS = [
 {value: 'default', label: 'Из оформления'},
 {value: 'blue', label: 'Синий'},
 {value: 'violet', label: 'Фиолетовый'},
 {value: 'green', label: 'Зелёный'},
 {value: 'rose', label: 'Розовый'},
 {value: 'orange', label: 'Оранжевый'}
] as const;

export type Accent = (typeof ACCENTS)[number]['value'];
export const ACCENT_STORAGE_KEY = 'sombra-accent';
export const isAccent = (value: string | null): value is Accent => ACCENTS.some(option => option.value === value);

export function getStoredAccent(): Accent {
 const saved = localStorage.getItem(ACCENT_STORAGE_KEY);
 return isAccent(saved) ? saved : 'default';
}
