import type {ReactElement} from 'react';
import {LoginPage} from '@/pages/login';
import {RegisterPage} from '@/pages/register';

export type AuthState = 'checking' | 'guest' | 'ready' | 'error';

export type AppRouteProps = {
 path: string;
 authOnly: boolean;
 element: ReactElement;
};

export const AppRoutes = {
 home: '#',
 login: '#login',
 register: '#register'
} as const;

export const routeConfig: Record<string, AppRouteProps> = {
 [AppRoutes.login]: {path: AppRoutes.login, authOnly: false, element: <LoginPage />},
 [AppRoutes.register]: {path: AppRoutes.register, authOnly: false, element: <RegisterPage />}
};
