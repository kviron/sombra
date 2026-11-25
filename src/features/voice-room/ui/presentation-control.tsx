import {TooltipLabel} from '@/shared/ui/tooltip';
import {useEffect, useMemo, useRef, useState} from 'react';
import {AppWindow, Monitor, MonitorOff, MonitorUp, Video, X} from 'lucide-react';
import {Dialog, Tabs} from 'radix-ui';
import {Button} from '@/shared/ui/button';
import {MotionIcon} from '@/shared/ui/motion-icon';
import type {PresentationSource} from '../model/voice-media';
import type {Voice} from '../model/use-voice';
import type {DesktopPresentationSource} from '@/shared/types/presentation';
import {desktopPresentation} from '../model/services/desktop-presentation';
import {PresentationSources} from './presentation-sources';
import {PresentationQualitySettings} from './presentation-quality-settings';

const tabs = [
 {id: 'window', label: 'Приложения', icon: AppWindow},
 {id: 'monitor', label: 'Весь экран', icon: Monitor},
 {id: 'camera', label: 'Устройства', icon: Video}
] as const;

function PresentationPicker({voice, onClose}: {voice: Voice; onClose: () => void}) {
 const [cameras, setCameras] = useState<MediaDeviceInfo[]>();
 const [deviceError, setDeviceError] = useState(false);
 const native = desktopPresentation.available();
 const [desktopSources, setDesktopSources] = useState<DesktopPresentationSource[] | null>();
 const sources = useMemo(
  () => ({
   window: desktopSources?.filter(source => source.kind === 'window') ?? [],
   monitor: desktopSources?.filter(source => source.kind === 'monitor') ?? []
  }),
  [desktopSources]
 );
 useEffect(() => {
  if (!native) return;
  let active = true;
  void desktopPresentation.sources().then(
   entries => {
    if (active) setDesktopSources(entries);
   },
   () => {
    if (active) setDesktopSources(null);
   }
  );
  return () => {
   active = false;
  };
 }, [native]);
 const canCaptureDisplay = typeof navigator.mediaDevices?.getDisplayMedia === 'function';
 useEffect(() => {
  let active = true;
  const devices = navigator.mediaDevices;
  if (!devices) return;
  function refresh() {
   void devices.enumerateDevices().then(
    entries => {
     if (!active) return;
     setCameras(entries.filter(entry => entry.kind === 'videoinput'));
     setDeviceError(false);
    },
    () => {
     if (active) setDeviceError(true);
    }
   );
  }
  refresh();
  devices.addEventListener('devicechange', refresh);
  return () => {
   active = false;
   devices.removeEventListener('devicechange', refresh);
  };
 }, []);

 async function start(source: PresentationSource) {
  if (await voice.startPresentation(source)) onClose();
 }

 return (
  <>
   <Dialog.Title className="text-lg font-semibold">Демонстрация экрана</Dialog.Title>
   <Dialog.Description className="mt-1 text-sm text-white/70">
    Выберите, что показать участникам голосовой комнаты.
   </Dialog.Description>
   <Tabs.Root defaultValue="window" className="mt-5 flex min-h-0 flex-1 flex-col">
    <Tabs.List
     aria-label="Источники демонстрации"
     className="grid shrink-0 grid-cols-3 gap-1 rounded-xl bg-white/5 p-1"
    >
     {tabs.map(({id, label, icon: Icon}) => (
      <Tabs.Trigger
       key={id}
       value={id}
       className="focus-visible:ring-primary flex min-h-10 items-center justify-center gap-1.5 rounded-lg px-1 text-xs text-white/70 outline-none hover:text-white focus-visible:ring-2 data-[state=active]:bg-white/12 data-[state=active]:text-white"
      >
       <Icon className="hidden size-4 shrink-0 sm:block" aria-hidden="true" />
       {label}
      </Tabs.Trigger>
     ))}
    </Tabs.List>
    {tabs.slice(0, 2).map(({id, icon: Icon}) => {
     const isWindow = id === 'window';
     return (
      <Tabs.Content key={id} value={id} className="mt-4 min-h-0 overflow-y-auto">
       {native && desktopSources === undefined ? (
        <p role="status" className="text-sm text-white/70">
         Поиск источников…
        </p>
       ) : desktopSources ? (
        <PresentationSources
         sources={sources[isWindow ? 'window' : 'monitor']}
         busy={voice.busy}
         onSelect={sourceId => void start({type: 'desktop', sourceId})}
        />
       ) : (
        <div className="rounded-xl border border-white/10 p-4">
         <Icon className="mb-3 size-6 text-white/70" aria-hidden="true" />
         <p className="font-medium">{isWindow ? 'Окно приложения' : 'Экран или монитор'}</p>
         <p className="mt-1 text-sm text-white/70">
          {canCaptureDisplay
           ? isWindow
             ? 'Выберите конкретное окно в системном диалоге.'
             : 'Если подключено несколько мониторов, выберите нужный в системном диалоге.'
           : 'Захват окон и мониторов недоступен в этой сборке Sombra.'}
         </p>
         <Button
          className="mt-4"
          disabled={voice.busy || !canCaptureDisplay}
          onClick={() => void start({type: isWindow ? 'window' : 'monitor'})}
         >
          {isWindow ? 'Выбрать окно' : 'Выбрать экран'}
         </Button>
        </div>
       )}
      </Tabs.Content>
     );
    })}
    <Tabs.Content value="camera" className="mt-4 min-h-0 space-y-2 overflow-y-auto">
     {cameras?.map((camera, index) => (
      <Button
       key={camera.deviceId || index}
       variant="outline"
       className="w-full justify-start"
       disabled={voice.busy}
       onClick={() => void start({type: 'camera', deviceId: camera.deviceId})}
      >
       <Video aria-hidden="true" />
       <span className="truncate">{camera.label || `Камера ${index + 1}`}</span>
      </Button>
     ))}
     {(!cameras?.length || deviceError) && (
      <p className="rounded-xl border border-white/10 p-4 text-sm text-white/70">
       {deviceError ? 'Не удалось получить список камер.' : cameras ? 'Камеры не найдены.' : 'Поиск камер…'}
      </p>
     )}
    </Tabs.Content>
   </Tabs.Root>
   <PresentationQualitySettings
    quality={voice.preferences.presentationQuality}
    disabled={voice.busy}
    onChange={quality => voice.savePreferences('presentationQuality', quality)}
   />
   {voice.error && (
    <p className="mt-3 text-sm text-red-300" role="alert">
     {voice.error}
    </p>
   )}
  </>
 );
}

export function PresentationControl({voice, compact = false}: {voice: Voice; compact?: boolean}) {
 const [openRoom, setOpenRoom] = useState('');
 const trigger = useRef<HTMLButtonElement>(null);
 const open = !!openRoom && openRoom === voice.room && !voice.presenting;
 const label = voice.presenting ? 'Остановить демонстрацию' : 'Продемонстрировать экран';
 return (
  <Dialog.Root open={open} onOpenChange={next => setOpenRoom(next ? voice.room : '')}>
   <TooltipLabel content={voice.audioOnly ? 'В этой комнате доступен только звук' : label}>
    <Button
     ref={trigger}
     type="button"
     variant={compact ? 'secondary' : 'ghost'}
     size={compact ? 'sm' : 'icon-lg'}
     aria-label={label}
     aria-haspopup={voice.presenting ? undefined : 'dialog'}
     aria-pressed={voice.presenting}
     disabled={voice.busy || voice.audioOnly}
     onClick={() => (voice.presenting ? void voice.stopPresentation() : setOpenRoom(voice.room))}
    >
     <MotionIcon icon={voice.presenting ? MonitorOff : MonitorUp} size={compact ? 16 : undefined} />
    </Button>
   </TooltipLabel>
   <Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-[1200] bg-black/45 backdrop-blur-sm" />
    <Dialog.Content
     className="fixed top-1/2 left-1/2 z-[1201] flex max-h-[calc(100dvh-2rem)] w-[min(52rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-auto rounded-2xl border border-white/15 bg-black/75 p-5 text-white shadow-xl backdrop-blur-xl"
     onCloseAutoFocus={event => {
      event.preventDefault();
      trigger.current?.focus();
     }}
     onEscapeKeyDown={event => {
      if (voice.busy) event.preventDefault();
     }}
     onInteractOutside={event => {
      if (voice.busy) event.preventDefault();
     }}
    >
     <Dialog.Close asChild>
      <Button
       variant="ghost"
       size="icon-sm"
       className="absolute top-3 right-3"
       aria-label="Закрыть"
       disabled={voice.busy}
      >
       <X />
      </Button>
     </Dialog.Close>
     <PresentationPicker voice={voice} onClose={() => setOpenRoom('')} />
    </Dialog.Content>
   </Dialog.Portal>
  </Dialog.Root>
 );
}
