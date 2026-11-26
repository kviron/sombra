import {TooltipLabel} from '@/shared/ui/tooltip';
import {useEffect, useRef, useState, type ReactNode} from 'react';
import {Maximize2, Minimize2, Users} from 'lucide-react';
import {Button} from '@/shared/ui/button';
import {UserAvatar} from '@/shared/ui/user-avatar';
import {UserContextMenu} from '@/entities/user';
import {useUserActions} from '@/shared/lib/user-actions';
import type {User, VoicePresence} from '@/shared/types';
import {selectRoomParticipants} from '../model/voice-selectors';
import {useLevelRail} from '../model/use-level-rail';
import {useMediaPlayback} from '../model/use-media-playback';
import type {Voice} from '../model/use-voice';

function hasVisibleVideo(stream?: MediaStream): boolean {
 return !!stream?.getVideoTracks().some(track => track.readyState === 'live' && track.enabled && !track.muted);
}

function VoiceTileVideo({stream, contain}: {stream: MediaStream; contain: boolean}) {
 const playback = useMediaPlayback({stream, volume: 0, audioOnly: false});
 const video = useRef<HTMLVideoElement>(null);

 useEffect(() => {
  const element = video.current;
  if (!element) return;
  function hide() {
   if (element) delete element.dataset.receiving;
  }
  function show() {
   if (element) element.dataset.receiving = 'true';
  }
  hide();
  const frame = element.requestVideoFrameCallback?.(show);
  if (frame === undefined) {
   if (element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) show();
   element.addEventListener('loadeddata', show);
  }
  element.addEventListener('emptied', hide);
  element.addEventListener('error', hide);
  return () => {
   if (frame !== undefined) element.cancelVideoFrameCallback(frame);
   element.removeEventListener('loadeddata', show);
   element.removeEventListener('emptied', hide);
   element.removeEventListener('error', hide);
  };
 }, [stream]);

 return (
  <video
   ref={element => {
    video.current = element;
    playback.attach(element);
   }}
   className={`pointer-events-none absolute inset-0 h-full w-full opacity-0 data-[receiving=true]:opacity-100 ${contain ? 'object-contain' : 'object-cover'}`}
   autoPlay
   playsInline
   muted
   onError={playback.onError}
  />
 );
}

function useVisibleVideo(stream?: MediaStream) {
 const [, refresh] = useState(0);
 useEffect(() => {
  if (!stream) return;
  let watched: MediaStreamTrack[] = [];
  const changed = () => refresh(value => value + 1);
  const sync = () => {
   for (const track of watched)
    for (const event of ['mute', 'unmute', 'ended']) track.removeEventListener(event, changed);
   watched = stream.getVideoTracks();
   for (const track of watched) for (const event of ['mute', 'unmute', 'ended']) track.addEventListener(event, changed);
   changed();
  };
  stream.addEventListener('addtrack', sync);
  stream.addEventListener('removetrack', sync);
  sync();
  return () => {
   stream.removeEventListener('addtrack', sync);
   stream.removeEventListener('removetrack', sync);
   for (const track of watched)
    for (const event of ['mute', 'unmute', 'ended']) track.removeEventListener(event, changed);
  };
 }, [stream]);
 return hasVisibleVideo(stream);
}

function VoicePeerVisual({
 stream,
 user,
 onOpen,
 onFocus,
 deaf,
 compact,
 selected
}: {
 stream?: MediaStream;
 user: User;
 onOpen: () => void;
 onFocus: () => void;
 deaf: boolean;
 compact: boolean;
 selected: boolean;
}) {
 const videoVisible = useVisibleVideo(stream);
 const rail = useLevelRail(stream, !deaf);
 return (
  <>
   <div className="voice-tile-rail" ref={rail} aria-hidden="true">
    <i />
   </div>
   <TooltipLabel content={`Профиль ${user.name}`}>
    <button
     type="button"
     className="voice-tile-avatar"
     aria-label={`Профиль ${user.name}`}
     tabIndex={videoVisible && !selected ? -1 : undefined}
     onClick={onOpen}
    >
     <UserAvatar user={user} size={compact ? 'md' : 'xl'} decoration={user.decorations?.avatar} />
    </button>
   </TooltipLabel>
   {stream && videoVisible && !selected && (
    <>
     <VoiceTileVideo stream={stream} contain />
     <TooltipLabel content={`Развернуть видео · ${user.name}`}>
      <Button
       type="button"
       variant="ghost"
       className="group/tile absolute inset-0 h-full w-full items-start justify-end rounded-none bg-transparent p-2 hover:bg-transparent dark:hover:bg-transparent"
       aria-label={`Развернуть видео · ${user.name}`}
       onClick={onFocus}
      >
       <span className="rounded-md bg-black/70 p-1.5 text-white opacity-0 group-hover/tile:opacity-100 group-focus-visible/tile:opacity-100">
        <Maximize2 aria-hidden="true" />
       </span>
      </Button>
     </TooltipLabel>
    </>
   )}
  </>
 );
}

type Props = {
 voice: Voice;
 room: string;
 presence?: VoicePresence[];
 users?: User[];
 meUser?: User;
 me: string;
 userName: (id: string) => string;
 intro: ReactNode;
 children: ReactNode;
};

export function VoiceRoomParticipants({voice, room, presence, users, meUser, me, userName, intro, children}: Props) {
 const actions = useUserActions();
 const [selected, setSelected] = useState<string>();
 const [hideParticipants, setHideParticipants] = useState(false);
 const joined = voice.room === room;
 const participants = selectRoomParticipants(voice, room, meUser?.id ?? '', presence);
 const selectedParticipant = joined ? participants.find(participant => participant.key === selected) : undefined;
 const selectedStream = selectedParticipant?.self
  ? (voice.local ?? undefined)
  : selectedParticipant && voice.streams[selectedParticipant.key];
 const hasSelectedVideo = useVisibleVideo(selectedStream);
 const focused = hasSelectedVideo && !!selectedStream && !!selectedParticipant;

 if (selected && !focused) {
  setSelected(undefined);
  setHideParticipants(false);
 }

 const tiles = participants.map(participant => {
  const {self, key, id} = participant;
  const identity: User = (self ? meUser : users?.find(user => user.id === id)) ?? {
   id,
   name: self ? me : userName(id),
   bio: '',
   created_at: 0,
   online: true
  };
  const stream = joined ? (self ? (voice.local ?? undefined) : voice.streams[key]) : undefined;
  const status = self
   ? voice.presenting
     ? 'Вы · Демонстрация'
     : voice.muted || voice.deaf
       ? 'Вы · микрофон выключен'
       : 'Вы'
   : !joined
     ? 'В комнате'
     : voice.connections[key] === 'connected'
       ? 'На связи'
       : voice.connections[key] === 'failed'
         ? 'Переподключаюсь…'
         : 'Подключение…';
  const tile = (
   <div
    key={key}
    className={`voice-tile border-border relative flex items-center justify-center overflow-hidden rounded-xl border bg-black/55 backdrop-blur-md ${focused ? 'h-20 w-32 shrink-0' : 'min-h-[160px]'}`}
   >
    <VoicePeerVisual
     stream={stream}
     user={identity}
     deaf={self ? voice.muted || voice.deaf : voice.deaf}
     compact={focused}
     selected={focused && key === selected}
     onOpen={() => {
      if (identity.id) actions?.openProfile(identity.id);
     }}
     onFocus={() => setSelected(key)}
    />
    <span className="bg-card pointer-events-none absolute right-auto bottom-2 left-2 max-w-[calc(100%-1rem)] truncate rounded px-2 py-1 text-xs">
     {identity.name}
     {!focused && ` · ${status}`}
    </span>
   </div>
  );
  return identity.id ? (
   <UserContextMenu key={key} user={identity}>
    {tile}
   </UserContextMenu>
  ) : (
   tile
  );
 });

 if (focused) {
  const name = selectedParticipant.self
   ? me
   : (users?.find(user => user.id === selectedParticipant.id)?.name ?? userName(selectedParticipant.id));
  const participantsLabel = hideParticipants ? 'Показать участников' : 'Скрыть участников';
  return (
   <section
    className="relative flex min-h-0 flex-1 flex-col gap-2 p-2"
    data-voice-video-focused
    aria-label={`Видео · ${name}`}
   >
    <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl bg-black/70">
     <VoiceTileVideo key={selectedParticipant.key} stream={selectedStream} contain />
     <div className="absolute inset-x-2 top-12 flex items-center justify-between gap-2">
      <span className="truncate rounded-md bg-black/70 px-2 py-1 text-xs text-white">{name}</span>
      <div className="flex shrink-0 gap-1">
       <TooltipLabel content={participantsLabel}>
        <Button
         type="button"
         variant="secondary"
         size="icon-sm"
         aria-expanded={!hideParticipants}
         aria-label={participantsLabel}
         onClick={() => setHideParticipants(hidden => !hidden)}
        >
         <Users />
        </Button>
       </TooltipLabel>
       <TooltipLabel content="Вернуться к сетке">
        <Button
         type="button"
         variant="secondary"
         size="icon-sm"
         aria-label="Вернуться к сетке"
         onClick={() => {
          setSelected(undefined);
          setHideParticipants(false);
         }}
        >
         <Minimize2 />
        </Button>
       </TooltipLabel>
      </div>
     </div>
    </div>
    {!hideParticipants && (
     <div
      className="absolute inset-x-2 bottom-20 flex justify-center-safe gap-2 overflow-x-auto"
      role="group"
      aria-label="Участники"
     >
      {tiles}
     </div>
    )}
    {children}
   </section>
  );
 }

 return (
  <div className="min-h-0 flex-1 overflow-auto">
   <div className="voice-stage min-h-full">
    {intro}
    {tiles.length > 0 && (
     <div className="voice-grid mx-0 my-2 mb-6 grid max-h-[60%] w-full max-w-[800px] grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3.5 overflow-auto">
      {tiles}
     </div>
    )}
    {children}
   </div>
  </div>
 );
}
