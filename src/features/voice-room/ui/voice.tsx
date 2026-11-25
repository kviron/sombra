import {selectRoomParticipants} from '../model/voice-selectors';
import type {RoomMusicModel} from '../model/use-room-music';
import {MotionIcon} from '@/shared/ui/motion-icon';
import {Button} from '@/shared/ui/button';
import {Switch} from '@/shared/ui/switch';
import {Slider} from '@/shared/ui/slider';
import {OptionsSelect} from '@/shared/ui/select';
import {AudioDeviceAccess} from './audio-device-access';
import {useLevelRail} from '../model/use-level-rail';
import {Label} from '@/shared/ui/label';
import {Progress} from '@/shared/ui/progress';
import {useEffect, useRef, useState} from 'react';
import {Mic, MicOff, Headphones, HeadphoneOff, Video, VideoOff, PhoneOff, Settings} from 'lucide-react';
import type {Voice} from '../model/use-voice';
import {UserAvatar} from '@/shared/ui/user-avatar';
import {UserContextMenu} from '@/entities/user';
import {useUserActions} from '@/shared/lib/user-actions';
import type {User, VoicePresence} from '@/shared/types';
import '@/shared/ui/account-media-settings.css';
import {RoomMusic} from './room-music';
import {useMediaPlayback} from '../model/use-media-playback';
import {useVoiceSettings, type VoiceSettingsModel} from '../model/use-voice-settings';

/** Один поток комнаты: разметка элемента и кнопка возврата звука; воспроизведение — в модели. */
export function Media({
 stream,
 muted,
 volume,
 speaker,
 audioOnly = false,
 className
}: {
 stream: MediaStream;
 muted: boolean;
 volume: number;
 speaker?: string;
 audioOnly?: boolean;
 className?: string;
}) {
 const playback = useMediaPlayback({stream, volume, speaker, audioOnly});
 return (
  <>
   {audioOnly ? (
    <audio className={className} ref={playback.attach} autoPlay muted={muted} onError={playback.onError} />
   ) : (
    <video className={className} ref={playback.attach} autoPlay playsInline muted={muted} onError={playback.onError} />
   )}
   {playback.blocked && (
    <Button variant="secondary" onClick={() => void playback.resume()}>
     Включить воспроизведение
    </Button>
   )}
   {playback.message && <small role="alert">{playback.message}</small>}
  </>
 );
}
// This is call-session infrastructure, not part of the selected conversation/stage.
// Keep one audible element per room/client; visual tiles always remain muted.
export function VoicePlayback({voice, volumeForUser}: {voice: Voice; volumeForUser: (id: string) => number}) {
 return (
  <div className="voice-playback absolute right-4 bottom-[70px] z-[3]" data-voice-room={voice.room}>
   {Object.entries(voice.streams).map(([client, stream]) => {
    // WebRTC can deliver video before audio. Don't start playback on an empty stream.
    if (!stream.getAudioTracks().some(track => track.readyState === 'live')) return null;
    const peer = voice.peers.find(peer => peer.client === client);
    const volume = voice.preferences.volume * (peer ? volumeForUser(peer.user) / 100 : 1);
    return (
     <Media
      key={`${voice.room}:${client}`}
      stream={stream}
      muted={voice.deaf}
      volume={volume}
      speaker={voice.speakerOutput}
      audioOnly
     />
    );
   })}
  </div>
 );
}
export function hasVisibleVideo(stream?: MediaStream): boolean {
 return !!stream?.getVideoTracks().some(track => track.readyState === 'live' && track.enabled && !track.muted);
}

function VoiceTileVideo({stream}: {stream: MediaStream}) {
 const playback = useMediaPlayback({stream, volume: 0, audioOnly: false});
 const video = useRef<HTMLVideoElement>(null);

 useEffect(() => {
  const element = video.current;
  if (!element || typeof element.requestVideoFrameCallback !== 'function') return;
  let frame = 0;
  let timeout: ReturnType<typeof setTimeout>;
  function hide() {
   if (element) delete element.dataset.receiving;
  }
  function onFrame() {
   if (!element) return;
   if (!element.dataset.receiving) element.dataset.receiving = 'true';
   clearTimeout(timeout);
   timeout = setTimeout(hide, 2000);
   frame = element.requestVideoFrameCallback(onFrame);
  }
  hide();
  frame = element.requestVideoFrameCallback(onFrame);
  element.addEventListener('emptied', hide);
  element.addEventListener('error', hide);
  return () => {
   element.cancelVideoFrameCallback(frame);
   clearTimeout(timeout);
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
   className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-0 data-[receiving=true]:opacity-100"
   autoPlay
   playsInline
   muted
   onError={playback.onError}
  />
 );
}

export function VoicePeerVisual({
 stream,
 user,
 onOpen,
 deaf = false
}: {
 stream?: MediaStream;
 user: User;
 onOpen: () => void;
 deaf?: boolean;
}) {
 const [, refresh] = useState(0);
 const rail = useLevelRail(stream, !deaf);
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
 return (
  <>
   <div className="voice-tile-rail" ref={rail} aria-hidden="true">
    <i />
   </div>
   <button type="button" className="voice-tile-avatar" title={`Профиль ${user.name}`} onClick={onOpen}>
    <UserAvatar user={user} size="xl" decoration={user.decorations?.avatar} />
   </button>
   {stream && hasVisibleVideo(stream) && <VoiceTileVideo stream={stream} />}
  </>
 );
}
export function VoiceStage({
 voice: v,
 id,
 title,
 userName,
 me,
 meUser,
 presence,
 users,
 onSettings,
 music
}: {
 voice: Voice;
 id: string;
 title: string;
 userName: (id: string) => string;
 me: string;
 meUser?: User;
 presence?: VoicePresence[];
 users?: User[];
 onSettings: () => void;
 music?: RoomMusicModel;
}) {
 const joined = v.room === id;
 const participants = selectRoomParticipants(v, id, meUser?.id ?? '', presence);
 const actions = useUserActions();
 const microphoneOff = v.muted || v.deaf;
 const selfRail = useLevelRail(v.local, joined && !microphoneOff);
 const selfIdentity: User = meUser ?? {id: '', name: me, bio: '', created_at: 0, online: true};
 const selfTile = (
  <div
   key="self"
   className="voice-tile border-border relative flex min-h-[160px] items-center justify-center overflow-hidden rounded-[12px] border bg-black/55 backdrop-blur-md [&>video]:h-[200px] [&>video]:w-full [&>video]:object-cover"
  >
   <div className="voice-tile-rail" ref={selfRail} aria-hidden="true">
    <i />
   </div>
   {v.camera && v.local ? (
    <Media stream={v.local} muted volume={0} />
   ) : (
    <button
     type="button"
     className="voice-tile-avatar"
     title="Открыть профиль"
     onClick={() => meUser && actions?.openProfile(meUser.id)}
    >
     <UserAvatar user={selfIdentity} size="xl" decoration={selfIdentity.decorations?.avatar} />
    </button>
   )}
   <span className="bg-card absolute bottom-2 left-2 rounded-[5px] px-2.5 py-1.5 text-[12px]">
    {me} · Вы {microphoneOff ? '· микрофон выключен' : ''}
   </span>
  </div>
 );
 return (
  <div className="voice-stage-region relative isolate flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
   <div className="min-h-0 flex-1 overflow-auto">
    <div className="voice-stage min-h-full">
     <h1 className="shrink-0">{title}</h1>
     <p>
      {joined
       ? v.peers.length
         ? 'Вы в голосовой комнате'
         : 'Вы в комнате. Пригласите друзей, чтобы начать общение.'
       : 'Присоединитесь, чтобы общаться голосом и видео'}
     </p>
     {participants.length > 0 && (
      <div className="voice-grid mx-0 my-2 mb-6 grid max-h-[60%] w-full max-w-[800px] grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3.5 overflow-auto">
       {participants.map(p => {
        if (p.self)
         return meUser ? (
          <UserContextMenu key={p.key} user={meUser}>
           {selfTile}
          </UserContextMenu>
         ) : (
          selfTile
         );
        const identity: User = (p.id === meUser?.id ? meUser : users?.find(user => user.id === p.id)) ?? {
         id: p.id,
         name: userName(p.id),
         bio: '',
         created_at: 0,
         online: true
        };
        const tile = (
         <div className="voice-tile border-border relative flex min-h-[160px] items-center justify-center overflow-hidden rounded-[12px] border bg-black/55 backdrop-blur-md">
          {
           <VoicePeerVisual
            stream={joined ? v.streams[p.key] : undefined}
            user={identity}
            deaf={v.deaf}
            onOpen={() => actions?.openProfile(identity.id)}
           />
          }
          <span className="bg-card absolute bottom-2 left-2 rounded-[5px] px-2.5 py-1.5 text-[12px]">
           {identity.name} ·{' '}
           {!joined
            ? 'В комнате'
            : v.connections[p.key] === 'connected'
              ? 'На связи'
              : v.connections[p.key] === 'failed'
                ? 'Переподключаюсь…'
                : 'Подключение…'}
          </span>
         </div>
        );
        return (
         <UserContextMenu key={p.key} user={identity}>
          {tile}
         </UserContextMenu>
        );
       })}
      </div>
     )}
     {joined && v.microphoneLost && (
      <p role="alert">
       Микрофон отключён.{' '}
       <Button variant="secondary" onClick={onSettings}>
        Выбрать микрофон
       </Button>
      </p>
     )}
     {v.error && (
      <p className="voice-error bg-primary text-foreground max-w-[550px] rounded-[8px] p-3.5" role="alert">
       {v.error}
      </p>
     )}
     {music && <RoomMusic key={id} music={music} joined={joined} />}
    </div>
   </div>
   <div
    className="voice-controls bg-card/70 mx-3 mb-3 flex shrink-0 flex-wrap justify-center gap-1 self-center rounded-xl border p-1.5 shadow-sm backdrop-blur-md motion-safe:transition-[opacity,transform] motion-safe:duration-200 motion-safe:ease-out"
    data-auto-hide={joined || undefined}
    role="group"
    aria-label="Управление звонком"
   >
    {joined ? (
     <>
      <Button
       variant="ghost"
       size="icon-lg"
       title={microphoneOff ? 'Включить микрофон' : 'Выключить микрофон'}
       aria-label="Микрофон"
       aria-pressed={microphoneOff}
       onClick={v.toggleMic}
      >
       {microphoneOff ? <MotionIcon icon={MicOff} kind="device" /> : <MotionIcon icon={Mic} kind="device" />}
      </Button>
      <Button
       variant="ghost"
       size="icon-lg"
       title={v.deaf ? 'Включить звук' : 'Отключить звук'}
       aria-label="Наушники"
       aria-pressed={v.deaf}
       onClick={v.toggleDeaf}
      >
       {v.deaf ? <MotionIcon icon={HeadphoneOff} kind="device" /> : <MotionIcon icon={Headphones} kind="device" />}
      </Button>
      <Button
       variant="ghost"
       size="icon-lg"
       disabled={v.busy || v.audioOnly}
       title={
        v.audioOnly
         ? 'Пилотная комната LiveKit поддерживает только звук'
         : v.camera
           ? 'Выключить камеру'
           : 'Включить камеру'
       }
       aria-label={v.camera ? 'Выключить камеру' : 'Включить камеру'}
       onClick={() => void v.toggleCamera()}
      >
       <MotionIcon icon={v.camera ? Video : VideoOff} />
      </Button>
      <Button variant="ghost" size="icon-lg" title="Отключиться" aria-label="Отключиться" onClick={v.leave}>
       <MotionIcon icon={PhoneOff} />
      </Button>
     </>
    ) : (
     <Button variant="secondary" className="min-h-10" disabled={v.busy} onClick={() => void v.join(id)}>
      {v.busy ? 'Подключение…' : 'Присоединиться к голосовому каналу'}
     </Button>
    )}
    <Button
     variant="ghost"
     size="icon-lg"
     title="Настройки голоса и видео"
     aria-label="Настройки голоса и видео"
     onClick={onSettings}
    >
     <MotionIcon icon={Settings} kind="settings" />
    </Button>
   </div>
  </div>
 );
}
/** Одно поле выбора устройства: только разметка, данные и колбэки приходят из модели. */
function DeviceField({field}: {field: VoiceSettingsModel['fields'][number]}) {
 return (
  <div className="voice-field">
   <Label htmlFor={`voice-${field.key}`}>{field.label}</Label>
   <OptionsSelect
    id={`voice-${field.key}`}
    label={field.label}
    value={field.value}
    disabled={field.disabled}
    onValueChange={field.select}
    options={field.options}
   />
   {field.missing && (
    <div className="audio-device-missing mt-1.5 min-w-0">
     <p className="text-muted-foreground my-1.5 text-[12px] leading-[1.5]" role="status">
      {field.key === 'speaker'
       ? 'Выбранные динамики недоступны. Пока используется системный выход.'
       : 'Выбранное устройство недоступно. Настройка сохранена.'}
     </p>
     <Button
      type="button"
      variant="secondary"
      size="sm"
      className="audio-device-reset"
      data-device-kind={field.kind}
      disabled={field.disabled}
      onClick={field.reset}
     >
      Использовать по умолчанию · {field.resetLabel}
     </Button>
    </div>
   )}
  </div>
 );
}

export function VoiceSettings({voice: v}: {voice: Voice}) {
 const settings = useVoiceSettings({voice: v});
 const p = v.preferences;
 return (
  <section className="voice-settings account-media-voice @container">
   <p>{v.room ? 'Устройства можно менять прямо во время звонка.' : 'Выберите устройства для звонков.'}</p>
   <AudioDeviceAccess devices={settings.devices} disabled={settings.devicesDisabled} />
   <section className="media-settings-panel" aria-label="Аудиоустройства">
    <div className="voice-device-fields">
     {settings.fields.slice(0, 2).map(field => (
      <DeviceField key={field.kind} field={field} />
     ))}
     <div className="voice-field voice-volume">
      <Label id="voice-volume-label">Громкость собеседников · {p.volume}%</Label>
      <Slider
       aria-label="Громкость собеседников"
       min={0}
       max={100}
       value={[p.volume]}
       onValueChange={([volume]) => v.savePreferences('volume', volume)}
      />
     </div>
    </div>
    <div className="voice-test-actions">
     <Button variant="secondary" disabled={settings.testDisabled} onClick={() => void settings.testMicrophone()}>
      Проверить микрофон
     </Button>
     <Progress aria-label="Уровень микрофона" value={settings.level} />
    </div>
   </section>
   <section className="media-settings-panel">
    <h2>Обработка звука</h2>
    <div className="voice-processing">
     <div className="voice-switch">
      <Label htmlFor="voice-echo">Эхоподавление</Label>
      <Switch id="voice-echo" disabled={v.busy} checked={p.echo} onCheckedChange={settings.applyEcho} />
     </div>
     <div className="voice-field">
      <Label htmlFor="voice-noise">Шумоподавление</Label>
      <OptionsSelect
       id="voice-noise"
       label="Шумоподавление"
       value={p.noise}
       disabled={v.busy}
       options={settings.noiseOptions}
       onValueChange={settings.applyNoise}
      />
     </div>
    </div>
   </section>
   <section className="media-settings-panel">
    <h2>Соединение</h2>
    <div className="voice-processing">
     <div className="voice-switch">
      <Label htmlFor="voice-relay">Всегда через сервер</Label>
      <Switch
       id="voice-relay"
       disabled={v.busy}
       checked={p.relay}
       onCheckedChange={checked => v.savePreferences('relay', checked)}
      />
     </div>
     <p className="settings-hint">
      Включите, если звук между участниками пропадает при прямом соединении. При наличии TURN новые соединения пойдут
      через него. По умолчанию маршрут выбирается автоматически. В комнате LiveKit звук всегда идёт через сервер.
     </p>
    </div>
   </section>
   <section className="media-settings-panel">
    <h2>Камера</h2>
    <div className="voice-device-fields">
     <DeviceField field={settings.fields[2]} />
     <Button variant="secondary" disabled={settings.testDisabled} onClick={() => void settings.testCamera()}>
      Проверить камеру
     </Button>
    </div>
    {settings.preview?.getVideoTracks().length ? (
     <Media stream={settings.preview} muted volume={0} className="bg-card mt-4 max-h-[280px] w-full rounded-[8px]" />
    ) : null}
   </section>
   {settings.preview && (
    <Button variant="secondary" onClick={() => settings.stop()}>
     Остановить проверку
    </Button>
   )}
   <p>При проверке разрешите доступ к устройствам. Звук не передаётся другим участникам.</p>
   {settings.error && <p role="alert">{settings.error}</p>}
  </section>
 );
}
