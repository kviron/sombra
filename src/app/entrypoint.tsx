import '@/shared/api/diagnostics';
import {startFreezeWatchdog} from '@/shared/api/freeze-watchdog';
import {watchMediaDevices} from '@/shared/lib/media-devices';
import {StrictMode} from 'react';
import ReactDOM from 'react-dom/client';
import '@/app/styles/index.css';
import {App} from '@/app/App';
import {ErrorBoundary} from '@/app/providers/ErrorBoundary';

// Сторож зависаний ставится до React: если первый рендер встанет, это будет видно в журнале.
startFreezeWatchdog();
const stopWatchingDevices = watchMediaDevices();
if (import.meta.hot) import.meta.hot.dispose(stopWatchingDevices);

// Let an app menu handle the event before suppressing the browser/WebView menu.
window.addEventListener('contextmenu', event => event.preventDefault());

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
 <StrictMode>
  <ErrorBoundary>
   <App />
  </ErrorBoundary>
 </StrictMode>
);
