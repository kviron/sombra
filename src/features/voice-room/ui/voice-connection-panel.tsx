import {TooltipLabel} from '@/shared/ui/tooltip';
import {Headphones, HeadphoneOff, Mic, MicOff, PhoneOff, Radio, Video, VideoOff} from 'lucide-react';
import {Button} from '@/shared/ui/button';
import {MotionIcon} from '@/shared/ui/motion-icon';
import type {Voice} from '../model/use-voice';
import {PresentationControl} from './presentation-control';

export function VoiceConnectionPanel({voice, roomName}: {voice: Voice; roomName: string}) {
 const micOff = voice.muted || voice.deaf;

 return (
  <section aria-label="Голосовая связь" className="bg-card/75 grid shrink-0 gap-2 border-t px-2.5 py-2">
   <div className="flex min-w-0 items-center gap-2">
    <span className="bg-primary/10 text-primary grid size-8 shrink-0 place-items-center rounded-lg">
     <Radio aria-hidden="true" className="size-4" />
    </span>
    <div className="min-w-0 flex-1">
     <p className="text-primary text-xs font-semibold">Голосовая связь</p>
     <TooltipLabel content={roomName}>
      <p className="text-muted-foreground truncate text-xs">{roomName}</p>
     </TooltipLabel>
    </div>
    <TooltipLabel content="Отключиться">
     <Button
      type="button"
      variant="destructive"
      size="icon-sm"
      aria-label="Отключиться от голосовой комнаты"
      onClick={voice.leave}
     >
      <MotionIcon icon={PhoneOff} size={16} />
     </Button>
    </TooltipLabel>
   </div>
   <div className="grid grid-cols-4 gap-1.5 [&>button]:min-w-0 [&>button]:px-0">
    <TooltipLabel content={micOff ? 'Включить микрофон' : 'Выключить микрофон'}>
     <Button
      type="button"
      variant="secondary"
      size="sm"
      aria-label="Микрофон"
      aria-pressed={micOff}
      onClick={voice.toggleMic}
     >
      <MotionIcon icon={micOff ? MicOff : Mic} size={16} />
     </Button>
    </TooltipLabel>
    <TooltipLabel content={voice.deaf ? 'Включить звук' : 'Отключить звук'}>
     <Button
      type="button"
      variant="secondary"
      size="sm"
      aria-label="Наушники"
      aria-pressed={voice.deaf}
      onClick={voice.toggleDeaf}
     >
      <MotionIcon icon={voice.deaf ? HeadphoneOff : Headphones} size={16} />
     </Button>
    </TooltipLabel>
    <TooltipLabel
     content={
      voice.audioOnly ? 'В этой комнате доступен только звук' : voice.camera ? 'Выключить камеру' : 'Включить камеру'
     }
    >
     <Button
      type="button"
      variant="secondary"
      size="sm"
      disabled={voice.busy || voice.audioOnly || voice.presenting}
      aria-label="Камера"
      aria-pressed={voice.camera}
      onClick={() => void voice.toggleCamera()}
     >
      <MotionIcon icon={voice.camera ? Video : VideoOff} size={16} />
     </Button>
    </TooltipLabel>
    <PresentationControl voice={voice} compact />
   </div>
  </section>
 );
}
