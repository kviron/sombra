import {TooltipLabel} from '@/shared/ui/tooltip';
import type {MouseEvent} from 'react';
import {ArrowLeft, ArrowRight} from 'lucide-react';
import {tauri} from '@/shared/api';
import {Button} from '@/shared/ui/button';
import {ThemeToggle} from './ThemeToggle';
import {WindowControls} from './WindowControls';

type TitleBarProps = {
 inTauri: boolean;
 isMaximized: boolean;
 canGoBack: boolean;
 canGoForward: boolean;
 onBack: () => void;
 onForward: () => void;
 theme: 'light' | 'dark';
 onToggleTheme: () => void;
};

export function TitleBar({
 inTauri,
 isMaximized,
 canGoBack,
 canGoForward,
 onBack,
 onForward,
 theme,
 onToggleTheme
}: TitleBarProps) {
 function handleMouseDown(event: MouseEvent<HTMLElement>) {
  if (!inTauri || event.button !== 0) return;
  if ((event.target as Element).closest('button, a, input, [data-no-drag]')) {
   return;
  }

  if (event.detail === 2) {
   void tauri.window.toggleMaximize();
   return;
  }

  void tauri.window.startDrag();
 }

 return (
  <header
   className="border-border/70 bg-background relative z-20 flex h-[var(--title-bar-height)] shrink-0 items-center justify-between gap-3 border-b pl-3 select-none"
   onMouseDown={handleMouseDown}
  >
   <nav aria-label="История переходов" className="flex items-center gap-1" data-no-drag>
    <TooltipLabel content="Назад">
     <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      className="text-muted-foreground"
      aria-label="Назад"
      disabled={!canGoBack}
      onClick={onBack}
     >
      <ArrowLeft />
     </Button>
    </TooltipLabel>
    <TooltipLabel content="Вперёд">
     <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      className="text-muted-foreground"
      aria-label="Вперёд"
      disabled={!canGoForward}
      onClick={onForward}
     >
      <ArrowRight />
     </Button>
    </TooltipLabel>
   </nav>

   <div className="flex h-full items-center gap-1 pr-1" data-no-drag>
    <ThemeToggle theme={theme} onToggle={onToggleTheme} />
    <WindowControls inTauri={inTauri} isMaximized={isMaximized} />
   </div>
  </header>
 );
}
