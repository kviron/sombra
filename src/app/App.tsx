import {useEffect, useState} from 'react';
import {UpdateNotice, UpdateSettings} from '@/features/updates';
import {api} from '@/shared/api/backend';
import {isTauri} from '@/shared/api';
import {Toaster} from '@/shared/ui';
import {AuthAmbient} from '@/shared/ui/auth-ambient';
import {AppRouter, type AuthState} from '@/app/providers/router';
import {useTheme, withTheme} from '@/app/providers/ThemeProvider';
import {useWindowMaximized} from '@/app/lib/use-window-maximized';
import {TitleBar} from '@/app/layout/title-bar';
import {WindowResizeHandles} from '@/app/layout/window-resize-handles';

import './styles/glass.css';
import './styles/settings.css';
import './styles/chat-extras.css';
import './styles/hologram.css';

function AppContent() {
 const [showUpdates,setShowUpdates]=useState(false);
 useEffect(()=>{const open=()=>setShowUpdates(true);window.addEventListener('sombra:open-updates',open);return()=>window.removeEventListener('sombra:open-updates',open)},[]);
 const [route, setRoute] = useState(window.location.hash);
 useEffect(() => {
  const navigate = () => setRoute(window.location.hash);
  window.addEventListener('hashchange', navigate);
  return () => window.removeEventListener('hashchange', navigate);
 }, []);
 const [auth, setAuth] = useState<AuthState>('checking');
 const [attempt, setAttempt] = useState(0);
 useEffect(() => {
  let active = true;
  const check = () => { setAuth('checking'); void api('me').then(() => { if(active) setAuth('ready'); }).catch(error => { if(active) setAuth(String(error).includes('Сессия') || String(error).includes('AUTH_REQUIRED') ? 'guest' : 'error'); }); };
  const changed = () => { setAuth('guest'); };
  check();
  window.addEventListener('authchange', changed);
  return () => { active=false; window.removeEventListener('authchange', changed); };
 }, [route, attempt]);
 const { theme } = useTheme();
 const inTauri = isTauri();
 const isMaximized = useWindowMaximized(inTauri);

 return (
  <div className={`app-surface relative flex h-svh flex-col overflow-hidden bg-background text-foreground ${auth === 'ready' ? 'chat-window' : 'auth-window mira-auth'}`}>
   {auth !== 'ready' && <AuthAmbient />}
   <TitleBar inTauri={inTauri} isMaximized={isMaximized} />
   <AppRouter auth={auth} route={route} onRetry={() => setAttempt(n => n+1)} />
   <WindowResizeHandles inTauri={inTauri} isMaximized={isMaximized} />
   <UpdateNotice />
   {showUpdates&&auth!=='ready'&&<div className="update-guest-overlay"><section className="update-guest-dialog" role="dialog" aria-modal="true" aria-label="Обновления Sombra"><button type="button" onClick={()=>setShowUpdates(false)} aria-label="Закрыть обновления">Закрыть</button><UpdateSettings inCall={false}/></section></div>}
   <Toaster
    position="bottom-right"
    theme={theme}
    offset={{ bottom: 60, right: 20 }}
   />
  </div>
 );
}

export const App = withTheme(AppContent);
