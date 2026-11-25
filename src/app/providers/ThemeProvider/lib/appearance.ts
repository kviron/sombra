/**
 * Оформление приложения — второй слой темы после светлой/тёмной.
 *
 * Значение попадает в `data-theme` на `<html>`: блок из `app/styles/themes.css`
 * подменяет палитру shadcn (Theming → Base Colors) и шрифт пресета. Светлая и
 * тёмная половина одного оформления выбирается классом `.dark`, поэтому оба
 * переключателя независимы: (оформление) × (светлая/тёмная).
 *
 * Названия взяты из shadcn 4.23: пресеты `nova`, `mira`, `lyra`, `sera` и
 * базовые цвета `stone`, `zinc`, `mauve`, `olive`, `mist`. Нейтральная палитра
 * с Geist — стоковая и служит оформлением по умолчанию.
 */
export type AppearanceId = 'nova' | 'mira' | 'lyra' | 'sera' | 'stone' | 'zinc' | 'mauve' | 'olive' | 'mist';

export type Appearance = {
 id: AppearanceId;
 label: string;
 description: string;
};

export const DEFAULT_APPEARANCE: AppearanceId = 'nova';

export const APPEARANCES: readonly Appearance[] = [
 {id: 'nova', label: 'Nova · Geist', description: 'Стоковый shadcn: нейтральная палитра и Geist.'},
 {id: 'mira', label: 'Mira · Inter', description: 'Пресет mira: нейтральная палитра, шрифт Inter.'},
 {id: 'lyra', label: 'Lyra · Mono', description: 'Пресет lyra: нейтральная палитра, JetBrains Mono.'},
 {id: 'sera', label: 'Sera · Taupe', description: 'Пресет sera: палитра taupe и засечные заголовки.'},
 {id: 'stone', label: 'Stone', description: 'Базовая палитра stone.'},
 {id: 'zinc', label: 'Zinc', description: 'Базовая палитра zinc.'},
 {id: 'mauve', label: 'Mauve', description: 'Базовая палитра mauve.'},
 {id: 'olive', label: 'Olive', description: 'Базовая палитра olive.'},
 {id: 'mist', label: 'Mist', description: 'Базовая палитра mist.'}
];

export const APPEARANCE_STORAGE_KEY = 'sombra-appearance';

export function isAppearance(value: string | null): value is AppearanceId {
 return APPEARANCES.some(item => item.id === value);
}

export function getStoredAppearance(): AppearanceId {
 const stored = localStorage.getItem(APPEARANCE_STORAGE_KEY);
 return isAppearance(stored) ? stored : DEFAULT_APPEARANCE;
}

export function applyAppearance(appearance: AppearanceId) {
 document.documentElement.dataset.theme = appearance;
}
