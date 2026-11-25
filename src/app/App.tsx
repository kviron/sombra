// App: раскладка из shared/layouts, данные и провайдеры остаются здесь.
import {useEffect, useState} from 'react';
import {UpdateNotice, UpdateSettings} from '@/features/updates';
import {userService} from '@/entities/user';
import {useChatRouteHistory} from '@/pages/chat';
import {isTauri} from '@/shared/api';
import {Toaster} from '@/shared/ui';
import {MainLayout, TitleBar, WindowResizeHandles} from '@/shared/layouts';
import {AppRouter, type AuthState} from '@/app/providers/router';
import {AppearanceSettings, useTheme, withTheme} from '@/app/providers/ThemeProvider';
import {useWindowMaximized} from '@/app/lib/use-window-maximized';

import './styles/settings.css';
import './styles/chat-extras.css';
import './styles/logo.css';
import './styles/themes.css';
import './styles/accents.css';

function AppContent() {
 const [showUpdates, setShowUpdates] = useState(false);
 useEffect(() => {
  const open = () => setShowUpdates(true);
  window.addEventListener('sombra:open-updates', open);
  return () => window.removeEventListener('sombra:open-updates', open);
 }, []);
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
  const check = () => {
   setAuth('checking');
   void userService
    .me()
    .then(() => {
     if (active) setAuth('ready');
    })
    .catch(error => {
     if (active)
      setAuth(String(error).includes('РЎРµСЃСЃРёСЏ') || String(error).includes('AUTH_REQUIRED') ? 'guest' : 'error');
    });
  };
  const changed = () => {
   setAuth('guest');
  };
  check();
  window.addEventListener('authchange', changed);
  return () => {
   active = false;
   window.removeEventListener('authchange', changed);
  };
 }, [route, attempt]);
 const {theme, toggleTheme} = useTheme();
 const inTauri = isTauri();
 const isMaximized = useWindowMaximized(inTauri);
 const history = useChatRouteHistory();

 return (
  <>
   <MainLayout
    className={`${auth === 'ready' ? 'chat-window' : 'auth-window'}`}
    titleBar={
     <TitleBar
      inTauri={inTauri}
      isMaximized={isMaximized}
      canGoBack={auth === 'ready' && history.canGoBack}
      canGoForward={auth === 'ready' && history.canGoForward}
      onBack={history.back}
      onForward={history.forward}
      theme={theme}
      onToggleTheme={toggleTheme}
     />
    }
    content={
     <AppRouter
      auth={auth}
      route={route}
      onRetry={() => setAttempt(n => n + 1)}
      appearanceSettings={<AppearanceSettings />}
     />
    }
    resizeHandles={<WindowResizeHandles inTauri={inTauri} isMaximized={isMaximized} />}
   />
   <UpdateNotice />
   {showUpdates && auth !== 'ready' && (
    <div className="update-guest-overlay">
     <section className="update-guest-dialog" role="dialog" aria-modal="true" aria-label="РћР±РЅРѕРІР»РµРЅРёСЏ Sombra">
      <button type="button" onClick={() => setShowUpdates(false)} aria-label="Р—Р°РєСЂС‹С‚СЊ РѕР±РЅРѕРІР»РµРЅРёСЏ">
       Р—Р°РєСЂС‹С‚СЊ
      </button>
      <UpdateSettings inCall={false} />
     </section>
    </div>
   )}
   <Toaster position="bottom-right" theme={theme} offset={{bottom: 60, right: 20}} />
  </>
 );
}

export const App = withTheme(AppContent);
