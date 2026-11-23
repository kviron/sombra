import {useEffect, useId, useRef, useState} from 'react';
import {ListMusic, Music2, Pause, Play, Plus, SkipForward, Square, Volume2} from 'lucide-react';
import {defaultGenerativeUILibrary, renderGenerativeUI} from '@assistant-ui/generative-ui/react';
import './room-music-elements.css';
import './room-music.css';
import {useRoomMusic as useRoomMusicModel} from '../model/use-room-music';

/**
 * Тонкая обёртка над моделью: создаёт элемент проигрывателя и отдаёт его в модель ссылкой.
 * Всё остальное — опрос, команды, приватное аудио и синхронизация позиции — в модели.
 */
export function useRoomMusic(room: string | undefined, deaf: boolean, speaker: string) {
 const engine = useRef<HTMLAudioElement>(null);
 const music = useRoomMusicModel(room, deaf, speaker, engine);
 return {
  ...music,
  audio: <audio ref={engine} src={music.playbackUrl} preload="metadata" onError={music.onAudioError} />
 };
}

/** Очередь и добавление трека: только разметка, данные и действия приходят из модели. */
export function RoomMusic({music, joined}: {music: ReturnType<typeof useRoomMusic>; joined: boolean}) {
 const [expanded, setExpanded] = useState(false),
  [pageSize, setPageSize] = useState(40),
  [, tick] = useState(0);
 const queueId = useId(),
  linkId = useId();
 const resetDraft = music.resetDraft;
 const track = joined ? music.track : null,
  playing = joined && music.playing,
  queue = joined ? music.queue : [],
  elapsed = joined ? music.elapsed() : 0;
 useEffect(() => {
  if (!playing) return;
  const timer = setInterval(() => tick(value => value + 1), 500);
  return () => clearInterval(timer);
 }, [playing]);
 // Панель открылась заново — черновик и ошибка прошлого открытия к ней не относятся.
 useEffect(() => resetDraft(), [resetDraft]);
 return (
  <section
   className="room-music mx-auto mt-4 w-[min(100%,416px)] flex-none text-start [overflow-wrap:anywhere]"
   data-aui-theme="elements"
   data-aui="card"
   data-aui-surface="true"
   aria-label="Музыка в комнате"
  >
   <header className="room-music-header flex min-w-0 flex-wrap items-center justify-between gap-2">
    <span className="inline-flex items-center gap-2">
     <Music2 size={16} /> Музыка в комнате
    </span>
    <button
     data-aui="button"
     data-aui-style="ghost"
     type="button"
     aria-expanded={expanded}
     aria-controls={queueId}
     onClick={() => setExpanded(!expanded)}
    >
     <ListMusic size={16} /> Очередь <span>{queue.length}</span>
    </button>
   </header>
   <div className="room-music-track flex min-w-0 flex-wrap items-center gap-2">
    <span className="room-music-art">
     <Music2 size={23} />
    </span>
    <div className="min-w-0">
     <strong>{track?.title ?? 'Сейчас ничего не играет'}</strong>
     <small className="block">{music.statusText(joined)}</small>
    </div>
   </div>
   {track && (
    <>
     <div className="room-music-progress flex min-w-0 flex-wrap items-center gap-2">
      <span>{music.trackTime(elapsed)}</span>
      <progress
       className="min-w-0 flex-1 [accent-color:var(--primary)]"
       aria-label="Позиция воспроизведения"
       value={elapsed}
       max={Math.max(1, track.durationMs)}
      />
      <span>{music.trackTime(track.durationMs)}</span>
     </div>
     <div className="room-music-actions flex min-w-0 flex-wrap items-center gap-2">
      <button
       data-aui="button"
       data-aui-style="primary"
       type="button"
       title={playing ? 'Пауза' : 'Продолжить'}
       aria-label={playing ? 'Пауза' : 'Продолжить'}
       disabled={music.pending}
       onClick={() => void music.run(playing ? 'pause' : 'resume')}
      >
       {playing ? <Pause size={18} /> : <Play size={18} />}
      </button>
      <button
       data-aui="button"
       data-aui-style="ghost"
       type="button"
       title="Следующий трек"
       aria-label="Следующий трек"
       disabled={music.pending}
       onClick={() => void music.run('skip')}
      >
       <SkipForward size={18} />
      </button>
      <button
       data-aui="button"
       data-aui-style="ghost"
       type="button"
       title="Остановить и очистить очередь"
       aria-label="Остановить и очистить очередь"
       disabled={music.pending}
       onClick={() => void music.run('stop')}
      >
       <Square size={16} />
      </button>
      <label className="inline-flex min-w-20 flex-1 items-center gap-2">
       <Volume2 size={16} />
       <input
        data-aui="slider"
        aria-label="Громкость музыки для вас"
        type="range"
        min="0"
        max="100"
        value={music.volume}
        onChange={event => music.setVolume(+event.target.value)}
       />
      </label>
     </div>
    </>
   )}
   {music.loadingPrivate && <small role="status">Загружаем аудио комнаты…</small>}
   {music.privateFailure && (
    <div role="alert" className="room-music-error text-destructive">
     {music.privateFailure}{' '}
     <button type="button" data-aui="button" data-aui-style="ghost" onClick={music.retryAudio}>
      Повторить
     </button>
    </div>
   )}
   {track && music.blocked && playing && !music.loadingPrivate && !music.privateFailure && (
    <button data-aui="button" data-aui-style="ghost" type="button" onClick={music.enableAudio}>
     Включить звук на этом устройстве
    </button>
   )}
   <div id={queueId} hidden={!expanded} className="min-w-0">
    {queue.length ? (
     <div className="room-music-queue max-h-[132px] overflow-auto">
      {renderGenerativeUI(
       {
        $type: 'ListView',
        children: music.queuePage(pageSize).map((item, index) => ({
         $type: 'ListViewItem',
         $key: item.id,
         children: {
          $type: 'Row',
          align: 'center',
          gap: 3,
          children: [
           {$type: 'Text', value: String(index + 1), size: 'sm', color: 'secondary'},
           {$type: 'Text', value: item.title, weight: 'medium'},
           {$type: 'Spacer'},
           {$type: 'Caption', text: music.trackTime(item.durationMs)}
          ]
         }
        }))
       },
       defaultGenerativeUILibrary,
       {status: 'done'}
      )}
      {music.hasMore(pageSize) && (
       <button type="button" data-aui="button" data-aui-style="ghost" onClick={() => setPageSize(n => n + 40)}>
        Показать ещё
       </button>
      )}
     </div>
    ) : (
     <p className="room-music-empty">В очереди пока нет треков.</p>
    )}
   </div>
   <form
    className="room-music-add grid min-w-0 grid-cols-[minmax(0,1fr)_80px_max-content] flex-wrap [align-items:end] gap-2"
    onSubmit={event => {
     event.preventDefault();
     if (!music.addDisabled(joined)) void music.addTrack();
    }}
   >
    <label className="room-music-link text-muted-foreground grid min-w-0 gap-1 text-[12px]">
     Ссылка
     <input
      data-aui="input"
      id={linkId}
      aria-label="Ссылка на трек или плейлист"
      placeholder="Трек или плейлист"
      value={music.link}
      maxLength={2048}
      onChange={event => music.setLink(event.target.value)}
      disabled={music.pending}
     />
    </label>
    <label className="room-music-limit text-muted-foreground grid min-w-0 gap-1 text-[12px]">
     Треков
     <input
      data-aui="input"
      type="number"
      min={1}
      max={1000}
      required
      value={music.limit}
      onChange={event => music.setLimit(event.target.value)}
      disabled={music.pending}
     />
    </label>
    <button data-aui="button" data-aui-style="secondary" type="submit" disabled={music.addDisabled(joined)}>
     <Plus size={16} /> Добавить
    </button>
   </form>
   {music.error && (
    <p role="alert" className="room-music-error text-destructive">
     {music.error}
    </p>
   )}
  </section>
 );
}
