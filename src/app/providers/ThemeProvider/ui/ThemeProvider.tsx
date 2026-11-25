import {useEffect, useState, type ReactNode} from 'react';
import {
 THEME_STORAGE_KEY,
 ThemeContext,
 applyTheme,
 getStoredTheme,
 getSystemTheme,
 type ThemeMode
} from '../lib/theme-context';
import {ACCENT_STORAGE_KEY, getStoredAccent, type Accent} from '../lib/accent';
import {
 APPEARANCES,
 APPEARANCE_STORAGE_KEY,
 applyAppearance,
 getStoredAppearance,
 type AppearanceId
} from '../lib/appearance';

type Props = {children: ReactNode};

/**
 * Провайдер темы по документации shadcn: класс `.dark` на `<html>` переключает
 * тёмные токены, `data-theme` — оформление (палитра + шрифт). Оба выбора
 * запоминаются в localStorage и независимы друг от друга.
 */
export function ThemeProvider({children}: Props) {
 const [themeMode, setThemeModeState] = useState<ThemeMode>(() => getStoredTheme() ?? 'system');
 const [systemTheme, setSystemTheme] = useState(getSystemTheme);
 const [appearance, setAppearanceState] = useState<AppearanceId>(getStoredAppearance);
 const [accent, setAccentState] = useState(getStoredAccent);
 const theme = themeMode === 'system' ? systemTheme : themeMode;

 useEffect(() => {
  applyTheme(theme);
 }, [theme]);

 useEffect(() => {
  applyAppearance(appearance);
 }, [appearance]);

 useEffect(() => {
  document.documentElement.dataset.accent = accent;
 }, [accent]);

 useEffect(() => {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const handleChange = (event: MediaQueryListEvent) => setSystemTheme(event.matches ? 'dark' : 'light');
  media.addEventListener('change', handleChange);
  return () => media.removeEventListener('change', handleChange);
 }, []);

 function toggleTheme() {
  setThemeMode(theme === 'dark' ? 'light' : 'dark');
 }

 function setThemeMode(next: ThemeMode) {
  if (next === 'system') localStorage.removeItem(THEME_STORAGE_KEY);
  else localStorage.setItem(THEME_STORAGE_KEY, next);
  setThemeModeState(next);
 }

 function setAppearance(next: AppearanceId) {
  localStorage.setItem(APPEARANCE_STORAGE_KEY, next);
  setAppearanceState(next);
 }

 function setAccent(next: Accent) {
  localStorage.setItem(ACCENT_STORAGE_KEY, next);
  setAccentState(next);
 }

 return (
  <ThemeContext.Provider
   value={{
    theme,
    toggleTheme,
    themeMode,
    setThemeMode,
    appearance,
    appearances: APPEARANCES,
    setAppearance,
    accent,
    setAccent
   }}
  >
   {children}
  </ThemeContext.Provider>
 );
}
