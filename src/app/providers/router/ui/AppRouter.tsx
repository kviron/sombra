import {memo} from 'react';
import {LiveChat} from '@/pages/chat';
import {routeConfig, type AuthState} from '../config/routeConfig';
import {RequireAuth} from './RequireAuth';

type Props = {auth: AuthState; route: string; onRetry: () => void};

/** Маршрутизация по hash: открытые экраны входа и чат за проверкой сессии. */
export const AppRouter = memo(({auth, route, onRetry}: Props) => {
 const entry = routeConfig[route];
 if (entry && auth !== 'ready') return entry.element;
 return (
  <RequireAuth auth={auth} onRetry={onRetry}>
   <LiveChat />
  </RequireAuth>
 );
});
