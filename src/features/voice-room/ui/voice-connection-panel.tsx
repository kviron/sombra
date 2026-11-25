import {Headphones, HeadphoneOff, Mic, MicOff, PhoneOff, Radio, Settings, Video, VideoOff} from 'lucide-react';
import {Button} from '@/shared/ui/button';
import {MotionIcon} from '@/shared/ui/motion-icon';
import type {Voice} from '../model/use-voice';

export function VoiceConnectionPanel({
 voice,
 roomName,
 onSettings
}: {
 voice: Voice;
 roomName: string;
 onSettings: () => void;
}) {
 const micOff = voice.muted || voice.deaf;

 return (
  <section aria-label="Голосовая связь" className="bg-card/75 grid shrink-0 gap-2 border-t px-2.5 py-2">
   <div className="flex min-w-0 items-center gap-2">
    <span className="bg-primary/10 text-primary grid size-8 shrink-0 place-items-center rounded-lg">
     <Radio aria-hidden="true" className="size-4" />
    </span>
    <div className="min-w-0 flex-1">
     <p className="text-primary text-xs font-semibold">Голосовая связь</p>
     <p className="text-muted-foreground truncate text-xs" title={roomName}>
      {roomName}
     </p>
    </div>
    <Button
     type="button"
     variant="destructive"
     size="icon-sm"
     aria-label="Отключиться от голосовой комнаты"
     title="Отключиться"
     onClick={voice.leave}
    >
     <MotionIcon icon={PhoneOff} size={16} />
    </Button>
   </div>
   <div className="grid grid-cols-4 gap-1.5 [&>button]:min-w-0 [&>button]:px-0">
    <Button
     type="button"
     variant="secondary"
     size="sm"
     aria-label="Микрофон"
     aria-pressed={micOff}
     title={micOff ? 'Включить микрофон' : 'Выключить микрофон'}
     onClick={voice.toggleMic}
    >
     <MotionIcon icon={micOff ? MicOff : Mic} size={16} />
    </Button>
    <Button
     type="button"
     variant="secondary"
     size="sm"
     aria-label="Наушники"
     aria-pressed={voice.deaf}
     title={voice.deaf ? 'Включить звук' : 'Отключить звук'}
     onClick={voice.toggleDeaf}
    >
     <MotionIcon icon={voice.deaf ? HeadphoneOff : Headphones} size={16} />
    </Button>
    <Button
     type="button"
     variant="secondary"
     size="sm"
     disabled={voice.busy || voice.audioOnly}
     aria-label="Камера"
     aria-pressed={voice.camera}
     title={
      voice.audioOnly ? 'В этой комнате доступен только звук' : voice.camera ? 'Выключить камеру' : 'Включить камеру'
     }
     onClick={() => void voice.toggleCamera()}
    >
     <MotionIcon icon={voice.camera ? Video : VideoOff} size={16} />
    </Button>
    <Button
     type="button"
     variant="secondary"
     size="sm"
     aria-label="Настройки голоса и видео"
     title="Настройки голоса и видео"
     onClick={onSettings}
    >
     <MotionIcon icon={Settings} kind="settings" size={16} />
    </Button>
   </div>
  </section>
 );
}
