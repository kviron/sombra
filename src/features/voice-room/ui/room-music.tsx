import {TooltipLabel} from '@/shared/ui/tooltip';
import {Button} from '@/shared/ui/button';
import {Card} from '@/shared/ui/card';
import {Input} from '@/shared/ui/input';
import {MotionIcon} from '@/shared/ui/motion-icon';
import {Slider} from '@/shared/ui/slider';
import {useEffect, useId, useRef, useState} from 'react';
import {ListMusic, Music2, Pause, Play, Plus, Shuffle, SkipForward, Square, Volume2} from 'lucide-react';
import type {MusicTrack} from '@/shared/types';
import type {RoomMusicModel} from '../model/use-room-music';

function TrackDetails({track, description}: {track?: MusicTrack | null; description?: string}) {
 return (
  <div className="flex min-w-0 flex-1 items-center gap-2.5">
   <span className="bg-muted text-muted-foreground relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-md">
    <Music2 className="size-4" aria-hidden="true" />
    {track?.coverUrl && (
     <img
      key={track.coverUrl}
      className="absolute inset-0 size-full object-cover"
      src={track.coverUrl}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={event => {
       event.currentTarget.hidden = true;
      }}
     />
    )}
   </span>
   <div className="min-w-0">
    <TooltipLabel content={track?.title}>
     <strong className="block truncate text-sm">{track?.title ?? 'Сейчас ничего не играет'}</strong>
    </TooltipLabel>
    <TooltipLabel content={track?.artist}>
     <span className="text-muted-foreground block truncate text-xs">
      {track?.artist ?? description ?? 'Исполнитель неизвестен'}
     </span>
    </TooltipLabel>
   </div>
  </div>
 );
}

function TrackProgress({music, duration}: {music: RoomMusicModel; duration: number}) {
 const [, tick] = useState(0);
 useEffect(() => {
  if (!music.playing) return;
  const timer = setInterval(() => tick(value => value + 1), 500);
  return () => clearInterval(timer);
 }, [music.playing]);
 const elapsed = music.elapsed();
 return (
  <div className="text-muted-foreground flex items-center gap-2 text-xs tabular-nums">
   <span>{music.trackTime(elapsed)}</span>
   <progress
    className="accent-primary min-w-0 flex-1"
    aria-label="Позиция воспроизведения"
    value={elapsed}
    max={Math.max(1, duration)}
   />
   <span>{music.trackTime(duration)}</span>
  </div>
 );
}

export function RoomMusicControl({music, joined}: {music: RoomMusicModel; joined: boolean}) {
 const [open, setOpen] = useState<'hover' | 'pinned' | null>(null);
 const panelId = useId();
 const root = useRef<HTMLDivElement>(null);
 const trigger = useRef<HTMLButtonElement>(null);
 const resetDraft = music.resetDraft;
 useEffect(() => resetDraft(), [resetDraft]);

 useEffect(() => {
  if (!open) return;
  function dismissOutside(event: PointerEvent) {
   if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(null);
  }
  function dismissOnEscape(event: KeyboardEvent) {
   if (event.key !== 'Escape' || event.defaultPrevented) return;
   if (root.current?.contains(document.activeElement)) trigger.current?.focus();
   setOpen(null);
  }
  document.addEventListener('pointerdown', dismissOutside);
  document.addEventListener('keydown', dismissOnEscape);
  return () => {
   document.removeEventListener('pointerdown', dismissOutside);
   document.removeEventListener('keydown', dismissOnEscape);
  };
 }, [open]);

 return (
  <div
   ref={root}
   data-music-open={open || undefined}
   onPointerLeave={() => setOpen(current => (current === 'hover' ? null : current))}
  >
   <TooltipLabel content="Музыка в комнате">
    <Button
     ref={trigger}
     type="button"
     variant="ghost"
     size="icon-lg"
     aria-label="Музыка в комнате"
     aria-expanded={open !== null}
     aria-controls={panelId}
     onPointerEnter={event => {
      if (event.pointerType === 'mouse') setOpen(current => current ?? 'hover');
     }}
     onClick={() => setOpen(current => (current === 'pinned' ? null : 'pinned'))}
    >
     <MotionIcon icon={Music2} />
    </Button>
   </TooltipLabel>
   <div
    id={panelId}
    hidden={!open}
    className="absolute bottom-[calc(100%-7px)] left-1/2 w-[min(28rem,calc(100cqw-1.5rem))] -translate-x-1/2 pb-[15px]"
    onPointerDown={() => setOpen('pinned')}
   >
    <RoomMusic music={music} joined={joined} visible={open !== null} />
   </div>
  </div>
 );
}

function RoomMusic({music, joined, visible}: {music: RoomMusicModel; joined: boolean; visible: boolean}) {
 const [expanded, setExpanded] = useState(true);
 const [pageSize, setPageSize] = useState(40);
 const queueId = useId();
 const track = joined ? music.track : null;
 const queue = joined ? music.queue : [];

 return (
  <Card
   size="sm"
   className="bg-card/80 max-h-[min(28rem,calc(100cqh-5rem))] w-full gap-3 overflow-y-auto p-3.5 text-start shadow-sm backdrop-blur-md"
   aria-label="Музыка в комнате"
  >
   <TrackDetails track={track} description={track ? undefined : music.statusText(joined)} />
   {track && (
    <>
     {visible && <TrackProgress music={music} duration={track.durationMs} />}
     <div className="flex flex-wrap items-center gap-1">
      <TooltipLabel content={music.playing ? 'Пауза' : 'Продолжить'}>
       <Button
        type="button"
        size="icon-sm"
        aria-label={music.playing ? 'Пауза' : 'Продолжить'}
        disabled={music.pending}
        onClick={() => void music.run(music.playing ? 'pause' : 'resume')}
       >
        {music.playing ? <Pause /> : <Play />}
       </Button>
      </TooltipLabel>
      <TooltipLabel content="Следующий трек">
       <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Следующий трек"
        disabled={music.pending}
        onClick={() => void music.run('skip')}
       >
        <SkipForward />
       </Button>
      </TooltipLabel>
      <TooltipLabel content="Перемешать очередь">
       <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Перемешать очередь"
        disabled={music.pending || queue.length < 2}
        onClick={() => void music.run('shuffle')}
       >
        <Shuffle />
       </Button>
      </TooltipLabel>
      <TooltipLabel content="Остановить и очистить очередь">
       <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Остановить и очистить очередь"
        disabled={music.pending}
        onClick={() => void music.run('stop')}
       >
        <Square />
       </Button>
      </TooltipLabel>
      <div className="text-muted-foreground ml-2 flex min-w-20 flex-1 items-center gap-2">
       <Volume2 className="size-4 shrink-0" aria-hidden="true" />
       <Slider
        aria-label="Громкость музыки для вас"
        max={100}
        value={[music.volume]}
        onValueChange={([volume]) => music.setVolume(volume)}
       />
      </div>
     </div>
    </>
   )}
   {music.loadingPrivate && <small role="status">Загружаем аудио комнаты…</small>}
   {music.privateFailure && (
    <div role="alert" className="text-destructive text-xs">
     {music.privateFailure}{' '}
     <Button type="button" variant="ghost" size="xs" onClick={music.retryAudio}>
      Повторить
     </Button>
    </div>
   )}
   {track && music.blocked && music.playing && !music.loadingPrivate && !music.privateFailure && (
    <Button variant="outline" size="sm" type="button" onClick={music.enableAudio}>
     Включить звук на этом устройстве
    </Button>
   )}
   <div className="grid gap-1.5 border-t pt-2">
    <Button
     type="button"
     variant="ghost"
     size="sm"
     className="justify-start"
     aria-expanded={expanded}
     aria-controls={queueId}
     onClick={() => setExpanded(value => !value)}
    >
     <ListMusic /> Очередь <span className="text-muted-foreground tabular-nums">{queue.length}</span>
    </Button>
    <div id={queueId} hidden={!expanded}>
     {queue.length ? (
      <div className="max-h-44 overflow-auto">
       <ol className="grid gap-1" aria-label="Следующие треки">
        {music.queuePage(pageSize).map(item => (
         <li key={item.id} className="flex min-w-0 items-center gap-2 rounded-lg px-1 py-0.5">
          <TrackDetails track={item} />
          <span className="text-muted-foreground text-xs tabular-nums">{music.trackTime(item.durationMs)}</span>
         </li>
        ))}
       </ol>
       {music.hasMore(pageSize) && (
        <Button type="button" size="sm" variant="ghost" onClick={() => setPageSize(n => n + 40)}>
         Показать ещё
        </Button>
       )}
      </div>
     ) : (
      <span className="text-muted-foreground px-2 text-xs">В очереди пока нет треков.</span>
     )}
    </div>
   </div>
   <form
    className="flex flex-wrap items-end gap-2"
    onSubmit={event => {
     event.preventDefault();
     if (!music.addDisabled(joined)) void music.addTrack();
    }}
   >
    <label className="text-muted-foreground grid min-w-28 flex-1 gap-1 text-xs">
     Ссылка
     <Input
      placeholder="Трек или плейлист"
      value={music.link}
      maxLength={2048}
      onChange={event => music.setLink(event.target.value)}
      disabled={music.pending}
     />
    </label>
    <label className="text-muted-foreground grid w-16 gap-1 text-xs">
     Треков
     <Input
      type="number"
      min={1}
      max={1000}
      required
      value={music.limit}
      onChange={event => music.setLimit(event.target.value)}
      disabled={music.pending}
     />
    </label>
    <TooltipLabel content="Добавить в очередь">
     <Button
      type="submit"
      variant="secondary"
      size="icon"
      aria-label="Добавить в очередь"
      disabled={music.addDisabled(joined)}
     >
      <Plus />
     </Button>
    </TooltipLabel>
   </form>
   {music.error && (
    <span role="alert" className="text-destructive text-xs">
     {music.error}
    </span>
   )}
  </Card>
 );
}
