import {useState} from 'react';
import {useAudioDevices, isDeviceSelectionMissing} from '../model/use-audio-devices';
import {AudioDeviceAccess} from './audio-device-access';
import {Popover} from 'radix-ui';
import {ChevronUp, Settings} from 'lucide-react';
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
 const [open, setOpen] = useState(false);
 const audioDevices = useAudioDevices(open);
 const {devices} = audioDevices;
 const input = kind === 'input';
 const key = input ? 'mic' : 'speaker';
 const label = input ? 'Устройство ввода' : 'Устройство вывода';
 const volumeLabel = input ? 'Громкость микрофона' : 'Громкость звука';
 const volume = input ? voice.micVolume : voice.preferences.volume;
 const matching = devices.filter(
  device => device.kind === (input ? 'audioinput' : 'audiooutput') && device.deviceId && device.deviceId !== 'default'
 );
 const selected = voice.preferences[key];
 const options = [
  {value: '', label: 'По умолчанию'},
  ...matching.map((device, index) => ({
   value: device.deviceId,
   label: device.label || `${input ? 'Микрофон' : 'Динамики'} ${index + 1}`
  }))
 ];
 const missing = isDeviceSelectionMissing(devices, audioDevices.loaded, input ? 'audioinput' : 'audiooutput', selected);
 if (selected && !options.some(option => option.value === selected))
  options.push({
   value: selected,
   label: missing
    ? 'Выбранное устройство (недоступно)'
    : selected === 'default'
      ? 'По умолчанию'
      : selected === 'communications'
        ? 'Устройство связи по умолчанию'
        : 'Выбранное устройство'
  });
 return (
  <Popover.Root open={open} onOpenChange={setOpen}>
   <Popover.Trigger asChild>
    <Button
     type="button"
     variant="ghost"
     size="icon-xs"
     className="voice-quick-trigger"
     aria-label={input ? 'Быстрые настройки микрофона' : 'Быстрые настройки наушников'}
     title={input ? 'Настройки микрофона' : 'Настройки наушников'}
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
     aria-label={input ? 'Быстрые настройки микрофона' : 'Быстрые настройки наушников'}
    >
     <label className="voice-quick-label" htmlFor={`quick-${kind}-device`}>
      {label}
     </label>
     <Select
      id={`quick-${kind}-device`}
      label={label}
      value={selected}
      disabled={voice.busy || audioDevices.requesting}
      options={options}
      onValueChange={value => voice.savePreferences(key, value)}
     />
     {missing && (
      <div className="audio-device-missing">
       <p role="status">Выбранное устройство недоступно. Настройка сохранена.</p>
       <Button
        type="button"
        variant="secondary"
        size="sm"
        className="audio-device-reset"
        data-device-kind={input ? 'audioinput' : 'audiooutput'}
        disabled={voice.busy || audioDevices.requesting}
        onClick={() => voice.savePreferences(key, '')}
       >
        Использовать по умолчанию · {input ? 'микрофон' : 'динамики'}
       </Button>
      </div>
     )}
     <AudioDeviceAccess devices={audioDevices} disabled={voice.busy} />
     <Separator className="my-4" />
     <div className="voice-quick-volume">
      <label id={`quick-${kind}-volume`}>{volumeLabel}</label>
      <output>{volume}%</output>
     </div>
     <Slider
      aria-labelledby={`quick-${kind}-volume`}
      min={0}
      max={input ? 200 : 100}
      value={[volume]}
      onValueChange={([value]) => (input ? voice.setMicVolume(value) : voice.savePreferences('volume', value))}
     />
     <Separator className="my-4" />
     <Button
      type="button"
      variant="ghost"
      className="voice-quick-settings-link"
      onClick={() => {
       setOpen(false);
       onSettings();
      }}
     >
      <Settings size={16} />
      Настройки голоса
     </Button>
    </Popover.Content>
   </Popover.Portal>
  </Popover.Root>
 );
}
