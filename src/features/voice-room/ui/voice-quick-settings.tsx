import {TooltipLabel} from '@/shared/ui/tooltip';
import {ChevronUp, Settings} from 'lucide-react';
import {AudioDeviceAccess} from './audio-device-access';
import {useState} from 'react';
import {selectMicrophones, selectSpeakers} from '@/shared/lib/media-devices';
import {useAudioDevices, isDeviceSelectionMissing} from '../model/use-audio-devices';
import {
 quickLabels,
 quickPreferenceKey,
 quickDeviceKind,
 quickVolume,
 quickVolumeMax,
 deviceOptions
} from '../model/voice-quick-settings-rules';
import {Button} from '@/shared/ui/button';
import {
 DropdownMenu,
 DropdownMenuTrigger,
 DropdownMenuContent,
 DropdownMenuGroup,
 DropdownMenuItem,
 DropdownMenuPortal,
 DropdownMenuSub,
 DropdownMenuSubTrigger,
 DropdownMenuSubContent,
 DropdownMenuRadioGroup,
 DropdownMenuRadioItem,
 DropdownMenuSeparator
} from '@/shared/ui/dropdown-menu';
import {Slider} from '@/shared/ui/slider';
import type {Voice} from '../model/use-voice';
import '@/shared/ui/menu-material.css';
import './voice-quick-settings.css';

export function VoiceQuickSettings({
 voice,
 kind,
 onSettings
}: {
 voice: Voice;
 kind: 'input' | 'output';
 onSettings: () => void;
}) {
 const [open, setOpen] = useState(false);
 const audioDevices = useAudioDevices(open, kind === 'input' ? selectMicrophones : selectSpeakers);
 const labels = quickLabels(kind);
 const deviceKind = quickDeviceKind(kind);
 const preference = quickPreferenceKey(kind);
 const preferred = voice.preferences[preference];
 const selected = kind === 'output' ? voice.speakerOutput : preferred;
 const missing =
  kind === 'output'
   ? selected !== preferred
   : isDeviceSelectionMissing(audioDevices.devices, audioDevices.loaded, deviceKind, preferred);
 const disabled = voice.busy || audioDevices.requesting;
 const volume = quickVolume(kind, voice);
 const options = deviceOptions({devices: audioDevices.devices, kind, selected, missing: kind === 'input' && missing});
 const selectedLabel = options.find(option => option.value === selected)?.label;
 const setDevice = (value: string) => voice.savePreferences(preference, value);

 return (
  <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
   <DropdownMenuTrigger asChild>
    <TooltipLabel content={labels.title}>
     <Button type="button" variant="ghost" size="icon-xs" className="voice-quick-trigger" aria-label={labels.aria}>
      <ChevronUp className="size-3" />
     </Button>
    </TooltipLabel>
   </DropdownMenuTrigger>
   <DropdownMenuContent
    side="top"
    align="end"
    sideOffset={10}
    collisionPadding={12}
    className="voice-quick-panel sombra-menu-surface"
    data-slot="dropdown-menu-content"
    aria-label={labels.aria}
    onKeyDown={event => {
     if (event.key !== 'Tab') return;
     const controls = [
      ...event.currentTarget.querySelectorAll<HTMLElement>(
       '[role="menuitem"]:not([data-disabled]), [role="slider"], button:not(:disabled)'
      )
     ];
     const current = controls.indexOf(document.activeElement as HTMLElement);
     const next = (current + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
     event.preventDefault();
     controls[next]?.focus();
    }}
   >
    <DropdownMenuGroup>
     <DropdownMenuSub>
      <DropdownMenuSubTrigger disabled={disabled} className="min-h-14">
       <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span>{labels.device}</span>
        <span className="text-muted-foreground truncate text-xs">{selectedLabel}</span>
       </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
       <DropdownMenuSubContent
        className="voice-quick-devices sombra-menu-surface w-72 max-w-[calc(100vw-24px)]"
        data-slot="dropdown-menu-content"
        sideOffset={6}
        collisionPadding={12}
        aria-label={labels.device}
       >
        <DropdownMenuRadioGroup value={selected} onValueChange={setDevice}>
         {options.map(option => (
          <DropdownMenuRadioItem
           key={option.value}
           value={option.value}
           disabled={disabled}
           textValue={option.label}
           onSelect={event => event.preventDefault()}
           className="min-h-11 py-2 pr-10 pl-2 [&>span:first-child]:right-2 [&>span:first-child]:left-auto [&>span:first-child]:size-4 [&>span:first-child]:rounded-full [&>span:first-child]:border"
          >
           <span className="min-w-0 [overflow-wrap:anywhere]">{option.label}</span>
          </DropdownMenuRadioItem>
         ))}
        </DropdownMenuRadioGroup>
       </DropdownMenuSubContent>
      </DropdownMenuPortal>
     </DropdownMenuSub>
    </DropdownMenuGroup>
    {missing && (
     <div className="audio-device-missing mt-1.5 min-w-0">
      <p className="text-muted-foreground my-1.5 text-[12px] leading-[1.5]" role="status">
       {kind === 'output'
        ? 'Выбранные динамики недоступны. Пока используется системный выход.'
        : 'Выбранное устройство недоступно. Настройка сохранена.'}
      </p>
      <Button
       type="button"
       variant="secondary"
       size="sm"
       className="audio-device-reset"
       data-device-kind={deviceKind}
       disabled={disabled}
       onClick={() => setDevice('')}
      >
       {labels.reset}
      </Button>
     </div>
    )}
    <AudioDeviceAccess devices={audioDevices} disabled={voice.busy} />
    <DropdownMenuSeparator className="my-2" />
    <div
     className="px-2 py-1"
     onKeyDown={event => {
      if (event.key !== 'Escape' && event.key !== 'Tab') event.stopPropagation();
     }}
    >
     <div className="voice-quick-volume mb-[9px] flex items-center justify-between gap-3 text-sm font-medium">
      <label id={`quick-${kind}-volume`}>{labels.volume}</label>
      <output className="text-muted-foreground tabular-nums">{volume}%</output>
     </div>
     <Slider
      aria-label={labels.volume}
      aria-labelledby={`quick-${kind}-volume`}
      min={0}
      max={quickVolumeMax(kind)}
      value={[volume]}
      onValueChange={([value]) =>
       kind === 'input' ? voice.setMicVolume(value) : voice.savePreferences('volume', value)
      }
     />
    </div>
    <DropdownMenuSeparator className="my-2" />
    <DropdownMenuGroup>
     <DropdownMenuItem
      className="voice-quick-settings-link"
      onSelect={() => {
       setOpen(false);
       onSettings();
      }}
     >
      <Settings size={16} />
      Настройки голоса
     </DropdownMenuItem>
    </DropdownMenuGroup>
   </DropdownMenuContent>
  </DropdownMenu>
 );
}
