import {Slider} from '@/shared/ui/slider';
// assistant-ui Elements MediaPlayer (MIT). Source commit 076de9eaf1b5f0f1fb6fb359c5e5d68770cae65c.
// https://github.com/assistant-ui/assistant-ui/blob/076de9eaf1b5f0f1fb6fb359c5e5d68770cae65c/packages/ui/src/components/react/assistant-ui/elements/media-player.tsx
// Sombra keeps the upstream geometry and behaviour; colours resolve through the Sombra theme tokens.
import {useEffect, useRef, useState, type ComponentProps, type RefObject} from 'react';
import {PauseIcon, PlayIcon} from 'lucide-react';
import {cn} from '@/shared/lib/utils';
import {inkButton, paper} from '@/shared/ui/elements-composer';

// Upstream exports this token from its surfaces module; Sombra keeps it next to the player.
const mono = 'font-mono text-[11px] tracking-tight';

export interface AudioPlayerProps extends Omit<ComponentProps<'div'>, 'children'> {
 src: string;
 title?: string | undefined;
 artwork?: string | undefined;
 durationMs?: number | undefined;
 /** Sombra: lets the message card fall back to an ordinary file card. */
 onPlaybackError?: (() => void) | undefined;
 /** Sombra: keeps the decoded blob pinned while the file is actually playing. */
 onPlaybackStateChange?: ((playing: boolean) => void) | undefined;
}

function formatDuration(seconds: number): string {
 const wholeSeconds = Math.max(0, Math.floor(seconds));
 const minutes = Math.floor(wholeSeconds / 60);
 const remainingSeconds = wholeSeconds % 60;
 return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

function useMediaDuration(mediaRef: RefObject<HTMLMediaElement | null>, src: string, durationMs?: number | undefined) {
 const [metadata, setMetadata] = useState<{src: string; duration?: number}>({
  src
 });

 // A server-rendered media element can load metadata before hydration attaches onLoadedMetadata.
 useEffect(() => {
  const media = mediaRef.current;
  if (!media || media.readyState < HTMLMediaElement.HAVE_METADATA) return;
  if (Number.isFinite(media.duration) && media.duration >= 0) {
   setMetadata({src, duration: media.duration});
  }
 }, [mediaRef, src]);
 const fallbackDuration =
  durationMs !== undefined && Number.isFinite(durationMs) ? Math.max(0, durationMs / 1000) : undefined;

 return {
  duration: metadata.src === src ? (metadata.duration ?? fallbackDuration) : fallbackDuration,
  setDurationFromMetadata: (duration: number) => {
   if (Number.isFinite(duration) && duration >= 0) {
    setMetadata({src, duration});
   }
  }
 };
}

export function AudioPlayer({
 src,
 title,
 artwork,
 durationMs,
 onPlaybackError,
 onPlaybackStateChange,
 className,
 ...props
}: AudioPlayerProps) {
 const audioRef = useRef<HTMLAudioElement>(null);
 const errorNotify = useRef(onPlaybackError);
 const playbackNotify = useRef(onPlaybackStateChange);
 const [playback, setPlayback] = useState({
  src,
  currentTime: 0,
  playing: false,
  hasError: false
 });
 const {duration, setDurationFromMetadata} = useMediaDuration(audioRef, src, durationMs);
 const playbackState = playback.src === src ? playback : {src, currentTime: 0, playing: false, hasError: false};
 const {currentTime, playing, hasError} = playbackState;
 const update = (patch: Partial<Omit<typeof playback, 'src'>>) =>
  setPlayback(current => ({
   ...(current.src === src ? current : {src, currentTime: 0, playing: false, hasError: false}),
   ...patch
  }));
 const displayTitle = title ?? 'Audio';
 const playbackLabel = title ? ` ${title}` : ' audio';
 const durationLabel = duration === undefined ? '--:--' : formatDuration(duration);

 useEffect(() => {
  errorNotify.current = onPlaybackError;
  playbackNotify.current = onPlaybackStateChange;
 }, [onPlaybackError, onPlaybackStateChange]);

 useEffect(() => {
  if (audioRef.current?.error) {
   setPlayback({src, currentTime: 0, playing: false, hasError: true});
   errorNotify.current?.();
  }
 }, [src]);

 const togglePlayback = () => {
  const audio = audioRef.current;
  if (!audio || hasError) return;

  if (playing) {
   audio.pause();
   update({playing: false});
   playbackNotify.current?.(false);
   return;
  }

  void audio.play().then(
   () => update({playing: true}),
   () => {
    update(audio.error ? {hasError: true, playing: false} : {playing: false});
    if (audio.error) {
     errorNotify.current?.();
     playbackNotify.current?.(false);
    }
   }
  );
 };

 return (
  <div
   data-slot="audio-player"
   className={cn(paper, 'flex w-full max-w-md items-center gap-3 rounded-2xl p-3', className)}
   {...props}
  >
   {artwork ? <img src={artwork} alt="" className="size-10 shrink-0 rounded-lg object-cover" /> : null}
   <button
    type="button"
    aria-label={`${playing ? 'Pause' : 'Play'}${playbackLabel}`}
    disabled={hasError}
    onClick={togglePlayback}
    className={cn(
     inkButton,
     'flex size-9 shrink-0 items-center justify-center rounded-full disabled:cursor-default disabled:opacity-40'
    )}
   >
    {playing ? <PauseIcon aria-hidden className="size-4" /> : <PlayIcon aria-hidden className="ml-0.5 size-4" />}
   </button>
   <div className="flex min-w-0 grow basis-16 flex-col gap-1.5">
    <span className="truncate text-[13.5px] font-medium" title={title}>
     {displayTitle}
    </span>
    <Slider
     min={0}
     max={duration || 1}
     step={0.1}
     value={[Math.min(currentTime, duration ?? 0)]}
     aria-label="Seek"
     aria-valuetext={`${formatDuration(currentTime)} of ${durationLabel}`}
     disabled={hasError || !duration}
     onValueChange={([nextTime]) => {
      if (!Number.isFinite(nextTime)) return;
      const resolvedTime = Math.min(nextTime, duration ?? nextTime);
      if (audioRef.current) audioRef.current.currentTime = resolvedTime;
      update({currentTime: resolvedTime});
     }}
     className="h-6"
    />
   </div>
   <span data-slot="audio-player-time" className={cn(mono, 'text-muted-foreground tabular-nums')}>
    {formatDuration(currentTime)}&nbsp;/ {durationLabel}
   </span>
   <audio
    ref={audioRef}
    src={src}
    preload="metadata"
    className="hidden"
    onLoadedMetadata={event => {
     setDurationFromMetadata(event.currentTarget.duration);
    }}
    onTimeUpdate={event => update({currentTime: event.currentTarget.currentTime})}
    onPlay={() => {
     update({playing: true});
     playbackNotify.current?.(true);
    }}
    onPause={() => {
     update({playing: false});
     playbackNotify.current?.(false);
    }}
    onEnded={() => {
     update({playing: false});
     playbackNotify.current?.(false);
    }}
    onError={() => {
     update({hasError: true, playing: false});
     errorNotify.current?.();
     playbackNotify.current?.(false);
    }}
   />
   {hasError ? (
    <span role="alert" className="text-muted-foreground text-xs">
     Can&apos;t play this audio
    </span>
   ) : null}
  </div>
 );
}
