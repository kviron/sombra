import {useEffect, useState} from 'react';
import {tauri} from '@/shared/api';

/**
 * Держит иконку заголовка в согласии с настоящим состоянием окна: разворот двойным
 * щелчком, привязка к краям и системные сочетания тоже приходят сюда.
 */
export function useWindowMaximized(inTauri: boolean) {
 const [isMaximized, setIsMaximized] = useState(false);

 useEffect(() => {
  if (!inTauri) return;

  let disposed = false;
  let unlisten: (() => void) | undefined;

  const sync = async () => {
   const value = await tauri.window.isMaximized();
   if (!disposed) setIsMaximized(value);
  };

  void sync();
  void tauri.window
   .onResized(() => void sync())
   .then(stop => {
    if (disposed) stop();
    else unlisten = stop;
   });

  return () => {
   disposed = true;
   unlisten?.();
  };
 }, [inTauri]);

 return isMaximized;
}
