import type {ReactNode} from 'react';
import {LoginPage} from '@/pages/login';
import type {AuthState} from '../config/routeConfig';

type Props = {auth: AuthState; onRetry: () => void; children: ReactNode};

/** Пускает дальше только с подтверждённой сессией: гость видит вход, проверка — статус. */
export function RequireAuth({auth, onRetry, children}: Props) {
 if (auth === 'ready') return <>{children}</>;
 if (auth === 'guest') return <LoginPage />;
 return (
  <main className="m-auto text-center">
   <p role="status">{auth === 'checking' ? 'Проверяем сессию…' : 'Не удалось проверить сессию.'}</p>
   {auth === 'error' && <button type="button" onClick={onRetry}>Повторить</button>}
  </main>
 );
}
