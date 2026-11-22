import {useEffect, useState, type MouseEvent} from 'react';
import {getAppVersion} from '@/shared/api';
import {Badge, SombraLogo} from '@/shared/ui';
import {startWindowDrag, toggleMaximizeWindow} from '@/app/lib/window-actions';
import {ThemeToggle} from './theme-toggle';
import {WindowControls} from './window-controls';

type TitleBarProps = {
 inTauri: boolean;
 isMaximized: boolean;
};

export function TitleBar({inTauri, isMaximized}: TitleBarProps) {
 const [version, setVersion] = useState('0.1.0');

 useEffect(() => {
  if (!inTauri) return;

  let active = true;

  getAppVersion()
   .then(value => {
    if (active) setVersion(value);
   })
   .catch(() => {
    // keep the fallback version if the IPC call is unavailable
   });

  return () => {
   active = false;
  };
 }, [inTauri]);

 function handleMouseDown(event: MouseEvent<HTMLElement>) {
  if (!inTauri || event.button !== 0) return;
  if ((event.target as Element).closest('button, a, input, [data-no-drag]')) {
   return;
  }

  if (event.detail === 2) {
   void toggleMaximizeWindow();
   return;
  }

  void startWindowDrag();
 }

 return (
  <header
   className="border-border/70 bg-background relative z-20 flex h-[var(--title-bar-height)] shrink-0 items-center justify-between gap-3 border-b pl-3 select-none"
   onMouseDown={handleMouseDown}
  >
   <div className="flex min-w-0 items-center gap-2">
    <SombraLogo className="sombra-logo--compact" />
    <Badge
     variant="outline"
     className="text-muted-foreground h-5 rounded-full px-2 font-mono text-[10px] font-normal tracking-[0.06em]"
    >
     v{version}
    </Badge>
   </div>

   <div className="flex h-full items-center gap-1 pr-1" data-no-drag>
    <ThemeToggle />
    <WindowControls inTauri={inTauri} isMaximized={isMaximized} />
   </div>
  </header>
 );
}
