import {createContext} from 'react';
import type {Appearance, AppearanceId} from './appearance';
import type {Accent} from './accent';

export type Theme = 'light' | 'dark';
export type ThemeMode = Theme | 'system';

export type ThemeContextValue = {
 theme: Theme;
 toggleTheme: () => void;
 themeMode: ThemeMode;
 setThemeMode: (mode: ThemeMode) => void;
 /** Оформление приложения: палитра и шрифт (см. lib/appearance.ts). */
 appearance: AppearanceId;
 appearances: readonly Appearance[];
 setAppearance: (appearance: AppearanceId) => void;
 accent: Accent;
 setAccent: (accent: Accent) => void;
};

export const THEME_STORAGE_KEY = 'mines-theme';

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function getSystemTheme(): Theme {
 return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function getStoredTheme(): Theme | null {
 const stored = localStorage.getItem(THEME_STORAGE_KEY);
 return stored === 'light' || stored === 'dark' ? stored : null;
}

export function applyTheme(theme: Theme = getStoredTheme() ?? getSystemTheme()) {
 const root = document.documentElement;
 root.classList.toggle('dark', theme === 'dark');
 root.style.colorScheme = theme;
}
