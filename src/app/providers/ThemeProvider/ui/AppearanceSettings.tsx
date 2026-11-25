import {OptionsSelect} from '@/shared/ui/select';
import {Label} from '@/shared/ui/label';
import {ACCENTS, isAccent} from '../lib/accent';
import {isAppearance} from '../lib/appearance';
import {useTheme} from '../lib/useTheme';

const themes = [
 {value: 'system', label: 'Как в системе'},
 {value: 'light', label: 'Светлая'},
 {value: 'dark', label: 'Тёмная'}
] as const;

export function AppearanceSettings() {
 const {themeMode, setThemeMode, appearance, appearances, setAppearance, accent, setAccent} = useTheme();

 return (
  <section>
   <div className="grid max-w-lg gap-5">
    <div className="grid gap-2">
     <Label htmlFor="appearance-theme">Тема</Label>
     <OptionsSelect
      id="appearance-theme"
      label="Тема"
      value={themeMode}
      options={themes}
      onValueChange={mode => {
       if (mode === 'system' || mode === 'light' || mode === 'dark') setThemeMode(mode);
      }}
     />
    </div>
    <div className="grid gap-2">
     <Label htmlFor="appearance-preset">Оформление</Label>
     <OptionsSelect
      id="appearance-preset"
      label="Оформление"
      value={appearance}
      options={appearances.map(item => ({value: item.id, label: item.label}))}
      onValueChange={value => {
       if (isAppearance(value)) setAppearance(value);
      }}
     />
    </div>
    <div className="grid gap-2">
     <Label htmlFor="appearance-accent">Акцентный цвет</Label>
     <OptionsSelect
      id="appearance-accent"
      label="Акцентный цвет"
      value={accent}
      options={ACCENTS}
      onValueChange={value => {
       if (isAccent(value)) setAccent(value);
      }}
     />
    </div>
   </div>
  </section>
 );
}
