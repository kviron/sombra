import {TooltipLabel} from '@/shared/ui/tooltip';
import {VoiceRoomParticipants} from './voice-room-participants';
import type {RoomMusicModel} from '../model/use-room-music';
import {MotionIcon} from '@/shared/ui/motion-icon';
import {Button} from '@/shared/ui/button';
import {Switch} from '@/shared/ui/switch';
import {Slider} from '@/shared/ui/slider';
import {OptionsSelect} from '@/shared/ui/select';
import {AudioDeviceAccess} from './audio-device-access';
import {Label} from '@/shared/ui/label';
import {Progress} from '@/shared/ui/progress';
import {Mic, MicOff, Headphones, HeadphoneOff, Video, VideoOff, PhoneOff, Settings} from 'lucide-react';
import type {Voice} from '../model/use-voice';
import type {User, VoicePresence} from '@/shared/types';
import '@/shared/ui/account-media-settings.css';
import {RoomMusicControl} from './room-music';
import {PresentationControl} from './presentation-control';
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
 const microphoneOff = v.muted || v.deaf;
 return (
  <div className="voice-stage-region [container-type:size] relative isolate flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
   <VoiceRoomParticipants
    key={id}
    voice={v}
    room={id}
    presence={presence}
    users={users}
    meUser={meUser}
    me={me}
    userName={userName}
    intro={
     <>
      <h1 className="shrink-0">{title}</h1>
      <p>
       {joined
        ? v.peers.length
          ? 'Вы в голосовой комнате'
          : 'Вы в комнате. Пригласите друзей, чтобы начать общение.'
        : 'Присоединитесь, чтобы общаться голосом и видео'}
      </p>
      {!joined && (
       <Button type="button" size="lg" className="min-h-10" disabled={v.busy} onClick={() => void v.join(id)}>
        {v.busy ? 'Подключение…' : 'Присоединиться к голосовому каналу'}
       </Button>
      )}
     </>
    }
   >
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
   </VoiceRoomParticipants>
   {joined && (
    <div
     className="voice-controls relative mx-3 mb-3 flex shrink-0 flex-wrap items-center justify-center gap-2 self-center motion-safe:transition-[opacity,transform] motion-safe:duration-200 motion-safe:ease-out"
     data-auto-hide
     role="group"
     aria-label="Управление звонком"
    >
     <div
      className="border-border bg-card/70 flex flex-wrap items-center justify-center gap-1 rounded-xl border p-1.5 shadow-sm backdrop-blur-md"
      role="group"
      aria-label="Устройства и настройки"
     >
      <TooltipLabel content={microphoneOff ? 'Включить микрофон' : 'Выключить микрофон'}>
       <Button variant="ghost" size="icon-lg" aria-label="Микрофон" aria-pressed={microphoneOff} onClick={v.toggleMic}>
        {microphoneOff ? <MotionIcon icon={MicOff} kind="device" /> : <MotionIcon icon={Mic} kind="device" />}
       </Button>
      </TooltipLabel>
      <TooltipLabel content={v.deaf ? 'Включить звук' : 'Отключить звук'}>
       <Button variant="ghost" size="icon-lg" aria-label="Наушники" aria-pressed={v.deaf} onClick={v.toggleDeaf}>
        {v.deaf ? <MotionIcon icon={HeadphoneOff} kind="device" /> : <MotionIcon icon={Headphones} kind="device" />}
       </Button>
      </TooltipLabel>
      <TooltipLabel
       content={
        v.audioOnly
         ? 'Пилотная комната LiveKit поддерживает только звук'
         : v.camera
           ? 'Выключить камеру'
           : 'Включить камеру'
       }
      >
       <Button
        variant="ghost"
        size="icon-lg"
        disabled={v.busy || v.audioOnly || v.presenting}
        aria-label={v.camera ? 'Выключить камеру' : 'Включить камеру'}
        onClick={() => void v.toggleCamera()}
       >
        <MotionIcon icon={v.camera ? Video : VideoOff} />
       </Button>
      </TooltipLabel>
      <TooltipLabel content="Настройки голоса и видео">
       <Button variant="ghost" size="icon-lg" aria-label="Настройки голоса и видео" onClick={onSettings}>
        <MotionIcon icon={Settings} kind="settings" />
       </Button>
      </TooltipLabel>
     </div>
     <div
      role="group"
      aria-label="Музыка и демонстрация экрана"
      className="before:border-border before:bg-card/70 grid before:pointer-events-none before:col-start-1 before:row-start-1 before:rounded-xl before:border before:shadow-sm before:backdrop-blur-md"
     >
      <div className="z-0 col-start-1 row-start-1 flex items-center gap-1 p-[7px]">
       {music && <RoomMusicControl key={id} music={music} joined />}
       <PresentationControl key={id} voice={v} />
      </div>
     </div>
     <TooltipLabel content="Отключиться">
      <Button
       type="button"
       variant="destructive"
       size="icon-lg"
       className="border-destructive/30 bg-destructive/65 hover:bg-destructive/80 dark:bg-destructive/65 dark:hover:bg-destructive/80 h-[50px] w-12 rounded-xl text-white shadow-sm backdrop-blur-md"
       aria-label="Отключиться"
       onClick={v.leave}
      >
       <MotionIcon icon={PhoneOff} />
      </Button>
     </TooltipLabel>
    </div>
   )}
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
