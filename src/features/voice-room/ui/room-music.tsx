import {Button} from '@/shared/ui/button';
import {Card} from '@/shared/ui/card';
import {Input} from '@/shared/ui/input';
import {Slider} from '@/shared/ui/slider';
import {useEffect, useId, useState} from 'react';
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
    <strong className="block truncate text-sm" title={track?.title}>
     {track?.title ?? 'Сейчас ничего не играет'}
    </strong>
    <span className="text-muted-foreground block truncate text-xs" title={track?.artist}>
     {track?.artist ?? description ?? 'Исполнитель неизвестен'}
    </span>
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

export function RoomMusic({music, joined}: {music: RoomMusicModel; joined: boolean}) {
 const [expanded, setExpanded] = useState(true);
 const [pageSize, setPageSize] = useState(40);
 const queueId = useId();
 const track = joined ? music.track : null;
 const queue = joined ? music.queue : [];
 const resetDraft = music.resetDraft;
 useEffect(() => resetDraft(), [resetDraft]);

 return (
  <Card
   size="sm"
   className="bg-card/80 mx-auto mt-4 w-full max-w-md shrink-0 gap-3 p-3.5 text-start shadow-sm backdrop-blur-md"
   aria-label="Музыка в комнате"
  >
   <TrackDetails track={track} description={track ? undefined : music.statusText(joined)} />
   {track && (
    <>
     <TrackProgress music={music} duration={track.durationMs} />
     <div className="flex flex-wrap items-center gap-1">
      <Button
       type="button"
       size="icon-sm"
       aria-label={music.playing ? 'Пауза' : 'Продолжить'}
       title={music.playing ? 'Пауза' : 'Продолжить'}
       disabled={music.pending}
       onClick={() => void music.run(music.playing ? 'pause' : 'resume')}
      >
       {music.playing ? <Pause /> : <Play />}
      </Button>
      <Button
       type="button"
       variant="ghost"
       size="icon-sm"
       aria-label="Следующий трек"
       title="Следующий трек"
       disabled={music.pending}
       onClick={() => void music.run('skip')}
      >
       <SkipForward />
      </Button>
      <Button
       type="button"
       variant="ghost"
       size="icon-sm"
       aria-label="Перемешать очередь"
       title="Перемешать очередь"
       disabled={music.pending || queue.length < 2}
       onClick={() => void music.run('shuffle')}
      >
       <Shuffle />
      </Button>
      <Button
       type="button"
       variant="ghost"
       size="icon-sm"
       aria-label="Остановить и очистить очередь"
       title="Остановить и очистить очередь"
       disabled={music.pending}
       onClick={() => void music.run('stop')}
      >
       <Square />
      </Button>
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
    <Button
     type="submit"
     variant="secondary"
     size="icon"
     aria-label="Добавить в очередь"
     title="Добавить в очередь"
     disabled={music.addDisabled(joined)}
    >
     <Plus />
    </Button>
   </form>
   {music.error && (
    <span role="alert" className="text-destructive text-xs">
     {music.error}
    </span>
   )}
  </Card>
 );
}
