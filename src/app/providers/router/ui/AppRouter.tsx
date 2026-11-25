import {memo, type ReactNode} from 'react';
import {LiveChat} from '@/pages/chat';
import {routeConfig, type AuthState} from '../config/routeConfig';
import {RequireAuth} from './RequireAuth';

type Props = {auth: AuthState; route: string; onRetry: () => void; appearanceSettings: ReactNode};

/** Маршрутизация по hash: открытые экраны входа и чат за проверкой сессии. */
export const AppRouter = memo(({auth, route, onRetry, appearanceSettings}: Props) => {
 const entry = routeConfig[route];
 if (entry && auth !== 'ready') return entry.element;
 return (
  <RequireAuth auth={auth} onRetry={onRetry}>
   <LiveChat appearanceSettings={appearanceSettings} />
  </RequireAuth>
 );
});
