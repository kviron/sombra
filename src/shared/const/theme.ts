export const Theme = {
 light: 'light',
 dark: 'dark'
} as const;

export type Theme = (typeof Theme)[keyof typeof Theme];

export const isTheme = (value: unknown): value is Theme => value === Theme.light || value === Theme.dark;
