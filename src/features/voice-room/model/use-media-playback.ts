import {useEffect, useMemo, useRef, useState} from 'react';
import {recordDesktopDiagnostic} from '@/shared/api/diagnostics';

type PlaybackGain = {
 context: AudioContext;
 source: MediaStreamAudioSourceNode;
 gain: GainNode;
 output: MediaStreamAudioDestinationNode;
};

type Options = {
 stream: MediaStream;
 volume: number;
 speaker?: string;
 audioOnly: boolean;
};

/**
 * Воспроизведение одного потока: автозапуск, усиление громкости выше 100% и выбор динамиков.
 * Состояние принадлежит конкретному элементу, поэтому это хук модели, а не общее хранилище:
 * в комнате одновременно звучат несколько потоков и общий флаг «заблокировано» их смешал бы.
 */
export function useMediaPlayback({stream, volume, speaker, audioOnly}: Options) {
 const ref = useRef<HTMLMediaElement>(null);
 const [blocked, setBlocked] = useState(false),
  [error, setError] = useState('');
 const processing = useRef<PlaybackGain | null>(null),
  [gainError, setGainError] = useState('');
 // Receiver streams can gain/replace audio without changing their MediaStream identity.
 const [, refreshAudio] = useState(0);
 const audioTrack = stream.getAudioTracks().find(track => track.readyState === 'live');
 useEffect(() => {
  const sync = () => refreshAudio(value => value + 1);
  stream.addEventListener('addtrack', sync);
  stream.addEventListener('removetrack', sync);
  return () => {
   stream.removeEventListener('addtrack', sync);
   stream.removeEventListener('removetrack', sync);
  };
 }, [stream]);
 // Video-only updates must not detach an otherwise unchanged audio receiver.
 const audioInput = useMemo(() => new MediaStream(audioTrack ? [audioTrack] : []), [audioTrack]);
 const input = audioOnly ? audioInput : stream;
 function playbackFailed(failure: unknown) {
  if (failure instanceof DOMException && failure.name === 'AbortError') return;
  if (speaker !== undefined)
   recordDesktopDiagnostic(
    'voice_playback',
    failure instanceof DOMException && failure.name === 'NotAllowedError' ? 'autoplay_blocked' : 'playback_error'
   );
  setBlocked(true);
 }
 useEffect(() => {
  const element = ref.current!;
  let active = true;
  element.srcObject = input;
  const play = () => {
   void element.play().then(
    () => {
     if (active) setBlocked(false);
    },
    failure => {
     if (active) playbackFailed(failure);
    }
   );
  };
  const receiver = audioOnly ? input.getAudioTracks()[0] : undefined;
  const retryWhenReceiving = () => {
   if (active && element.paused) play();
  };
  receiver?.addEventListener('unmute', retryWhenReceiving);
  play();
  return () => {
   active = false;
   receiver?.removeEventListener('unmute', retryWhenReceiving);
   element.srcObject = null;
   const graph = processing.current;
   if (graph) {
    processing.current = null;
    graph.source.disconnect();
    graph.gain.disconnect();
    graph.output.stream.getTracks().forEach(track => track.stop());
    void graph.context.close();
   }
  };
 }, [input]);
 useEffect(() => {
  const element = ref.current!;
  setGainError('');
  let context: AudioContext | undefined;
  if (volume > 100 && !processing.current && input.getAudioTracks().length) {
   try {
    context = new AudioContext();
    const source = context.createMediaStreamSource(input),
     gain = context.createGain(),
     output = context.createMediaStreamDestination();
    source.connect(gain).connect(output);
    const graph = {context, source, gain, output};
    processing.current = graph;
    // Keep the amplified audio on the same element so its output device and mute state still apply.
    element.srcObject = new MediaStream([...input.getVideoTracks(), ...output.stream.getAudioTracks()]);
    void Promise.all([context.resume(), element.play()]).then(
     () => {
      if (processing.current === graph) setBlocked(false);
     },
     failure => {
      if (processing.current === graph) playbackFailed(failure);
     }
    );
   } catch {
    if (context) void context.close();
    if (speaker !== undefined) recordDesktopDiagnostic('voice_output', 'playback_failed');
    setGainError('Не удалось усилить звук.');
   }
  }
  const graph = processing.current;
  if (graph) graph.gain.gain.value = volume / 100;
  element.volume = graph ? 1 : Math.min(1, volume / 100);
 }, [input, volume]);
 useEffect(() => {
  const element = ref.current!;
  let active = true;
  setError('');
  if (speaker !== undefined) {
   if (element.setSinkId)
    void element.setSinkId(speaker).catch(failure => {
     if (active) {
      recordDesktopDiagnostic(
       'voice_speaker',
       failure.name === 'NotAllowedError' ? 'device_permission' : 'device_error'
      );
      setError('Не удалось выбрать динамики. Проверьте настройки.');
     }
    });
   else if (speaker) {
    recordDesktopDiagnostic('voice_output', 'output_device_failed');
    setError('Выбор динамиков недоступен в этом режиме.');
   }
  }
  return () => {
   active = false;
  };
 }, [speaker]);
 async function resumePlayback() {
  try {
   const element = ref.current;
   if (element?.error && element.srcObject) {
    const playbackStream = element.srcObject;
    element.srcObject = null;
    element.srcObject = playbackStream;
   }
   await Promise.all([element?.play(), processing.current?.context.resume()]);
   setBlocked(false);
  } catch (failure) {
   playbackFailed(failure);
  }
 }
 const attach = (element: HTMLMediaElement | null) => {
  ref.current = element;
 };
 const onError = () => playbackFailed(ref.current?.error);
 return {attach, blocked, message: error || gainError, resume: resumePlayback, onError};
}
