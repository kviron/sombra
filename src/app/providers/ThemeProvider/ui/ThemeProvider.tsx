import {useEffect, useState, type ReactNode} from 'react';
import {THEME_STORAGE_KEY, ThemeContext, getStoredTheme, getSystemTheme, type Theme} from '../lib/theme-context';

type Props = {children: ReactNode};

export function ThemeProvider({children}: Props) {
 const [theme, setTheme] = useState<Theme>(() => getStoredTheme() ?? getSystemTheme());
 const [followsSystem, setFollowsSystem] = useState(() => getStoredTheme() === null);

 useEffect(() => {
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.style.colorScheme = theme;
 }, [theme]);

 useEffect(() => {
  if (!followsSystem) return;
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const handleChange = (event: MediaQueryListEvent) => setTheme(event.matches ? 'dark' : 'light');
  media.addEventListener('change', handleChange);
  return () => media.removeEventListener('change', handleChange);
 }, [followsSystem]);

 function toggleTheme() {
  const next: Theme = theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem(THEME_STORAGE_KEY, next);
  setFollowsSystem(false);
  setTheme(next);
 }

 return <ThemeContext.Provider value={{theme, toggleTheme}}>{children}</ThemeContext.Provider>;
}
