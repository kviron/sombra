import {MoonIcon, SunIcon} from 'lucide-react';
import {Button} from '@/shared/ui';

type ThemeToggleProps = {
 theme: 'light' | 'dark';
 onToggle: () => void;
};

export function ThemeToggle({theme, onToggle}: ThemeToggleProps) {
 const isDark = theme === 'dark';
 const label = isDark ? 'Включить светлую тему' : 'Включить тёмную тему';

 return (
  <Button
   variant="ghost"
   size="icon-sm"
   className="text-muted-foreground hover:text-foreground"
   aria-label={label}
   title={label}
   onClick={onToggle}
  >
   {isDark ? <SunIcon /> : <MoonIcon />}
  </Button>
 );
}
