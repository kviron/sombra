import type {ComponentType} from 'react';
import {ThemeProvider} from './ThemeProvider';

/** HOC как в структуре проекта: оборачивает приложение провайдером темы. */
export function withTheme(Component: ComponentType) {
 const WithTheme = () => (
  <ThemeProvider>
   <Component />
  </ThemeProvider>
 );
 WithTheme.displayName = `withTheme(${Component.displayName ?? Component.name})`;
 return WithTheme;
}
