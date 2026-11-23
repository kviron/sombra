import {Popover} from 'radix-ui';
import {ChevronUp, Settings} from 'lucide-react';
import {AudioDeviceAccess} from './audio-device-access';
import {useVoiceQuickSettings} from '../model/use-voice-quick-settings';
import {Button} from '@/shared/ui/button';
import {Select} from '@/shared/ui/select';
import {Slider} from '@/shared/ui/slider';
import {Separator} from '@/shared/ui/separator';
import type {Voice} from '../model/use-voice';
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
 const model = useVoiceQuickSettings({voice, kind, onSettings});
 return (
  <Popover.Root open={model.open} onOpenChange={model.setOpen}>
   <Popover.Trigger asChild>
    <Button
     type="button"
     variant="ghost"
     size="icon-xs"
     className="voice-quick-trigger"
     aria-label={model.labels.aria}
     title={model.labels.title}
    >
     <ChevronUp size={12} />
    </Button>
   </Popover.Trigger>
   <Popover.Portal>
    <Popover.Content
     side="top"
     align="end"
     sideOffset={10}
     collisionPadding={12}
     className="voice-quick-panel sombra-menu-surface dark"
     data-slot="popover-content"
     aria-label={model.labels.aria}
    >
     <label className="voice-quick-label mb-[9px] block font-semibold" htmlFor={`quick-${kind}-device`}>
      {model.labels.device}
     </label>
     <Select
      id={`quick-${kind}-device`}
      label={model.labels.device}
      value={model.selected}
      disabled={model.disabled}
      options={model.options}
      onValueChange={model.setDevice}
     />
     {model.missing && (
      <div className="audio-device-missing mt-1.5 min-w-0">
       <p className="my-1.5 text-[12px] leading-[1.5] text-[#b1b8c6]" role="status">
        Выбранное устройство недоступно. Настройка сохранена.
       </p>
       <Button
        type="button"
        variant="secondary"
        size="sm"
        className="audio-device-reset"
        data-device-kind={kind === 'input' ? 'audioinput' : 'audiooutput'}
        disabled={model.disabled}
        onClick={() => model.resetDevice()}
       >
        {model.labels.reset}
       </Button>
      </div>
     )}
     <AudioDeviceAccess devices={model.audioDevices} disabled={voice.busy} />
     <Separator className="my-4" />
     <div className="voice-quick-volume mb-[9px] flex items-center justify-between gap-3 font-semibold">
      <label id={`quick-${kind}-volume`}>{model.labels.volume}</label>
      <output className="text-[#aeb7ca] tabular-nums">{model.volume}%</output>
     </div>
     <Slider
      aria-labelledby={`quick-${kind}-volume`}
      min={0}
      max={model.volumeMax}
      value={[model.volume]}
      onValueChange={([value]) => model.setVolume(value)}
     />
     <Separator className="my-4" />
     <Button type="button" variant="ghost" className="voice-quick-settings-link" onClick={model.openSettings}>
      <Settings size={16} />
      Настройки голоса
     </Button>
    </Popover.Content>
   </Popover.Portal>
  </Popover.Root>
 );
}
