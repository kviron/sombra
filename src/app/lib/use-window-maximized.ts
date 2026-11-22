import {useEffect, useState} from 'react';
import {getCurrentWindow} from '@tauri-apps/api/window';

/**
 * Keeps the custom title bar icon in sync with the real window state,
 * including maximize via double-click, snap layouts and the OS shortcuts.
 */
export function useWindowMaximized(inTauri: boolean) {
 const [isMaximized, setIsMaximized] = useState(false);

 useEffect(() => {
  if (!inTauri) return;

  const appWindow = getCurrentWindow();
  let disposed = false;
  let unlisten: (() => void) | undefined;

  function syncMaximizedState() {
   appWindow
    .isMaximized()
    .then(value => {
     if (!disposed) setIsMaximized(value);
    })
    .catch(() => {
     // window state is optional for the UI
    });
  }

  syncMaximizedState();

  appWindow
   .onResized(syncMaximizedState)
   .then(stopListening => {
    if (disposed) stopListening();
    else unlisten = stopListening;
   })
   .catch(() => {
    // listening is best-effort
   });

  return () => {
   disposed = true;
   unlisten?.();
  };
 }, [inTauri]);

 return isMaximized;
}
