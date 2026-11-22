import { UpdateNotice, UpdateSettings } from './updates';
import { LiveChat } from './live-chat';
import { api } from '@/shared/api/backend';
import { useEffect, useState } from "react";

import { RegisterPage } from "./register-page";
import { isTauri } from "@/shared/api";
import { Toaster } from "@/shared/ui";
import { LoginPage } from "./login-page";
import { AuthAmbient } from './auth-ambient';
import { useTheme } from "@/app/theme";
import { useWindowMaximized } from "@/app/model/use-window-maximized";
import { TitleBar } from "@/app/layout/title-bar";
import { WindowResizeHandles } from "@/app/layout/window-resize-handles";

import './glass.css';
import './settings.css';
import './chat-extras.css';
import './hologram.css';

export function App() {
  const [showUpdates,setShowUpdates]=useState(false);
  useEffect(()=>{const open=()=>setShowUpdates(true);window.addEventListener('sombra:open-updates',open);return()=>window.removeEventListener('sombra:open-updates',open)},[]);
  const [route, setRoute] = useState(window.location.hash);
  useEffect(() => {
    const navigate = () => setRoute(window.location.hash);
    window.addEventListener("hashchange", navigate);
    return () => window.removeEventListener("hashchange", navigate);
  }, []);
  const [auth, setAuth] = useState<'checking'|'guest'|'ready'|'error'>('checking');
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
    <div className={`app-surface relative flex h-svh flex-col overflow-hidden bg-background text-foreground ${auth === "ready" ? "chat-window" : "auth-window mira-auth"}`}>
      {auth !== 'ready' && <AuthAmbient />}
      <TitleBar inTauri={inTauri} isMaximized={isMaximized} />
      {auth === 'ready' ? <LiveChat /> : route === '#register' ? <RegisterPage /> : route === '#login' || auth === 'guest' ? <LoginPage /> : <main className="m-auto text-center"><p role="status">{auth === 'checking' ? 'Проверяем сессию…' : 'Не удалось проверить сессию.'}</p>{auth === 'error' && <button onClick={() => setAttempt(n => n+1)}>Повторить</button>}</main>}
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




