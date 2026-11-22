import {createContext} from 'react';

export type Theme = 'light' | 'dark';

export type ThemeContextValue = {
 theme: Theme;
 toggleTheme: () => void;
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
