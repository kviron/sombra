import {TooltipLabel} from '@/shared/ui/tooltip';
import {selectVoiceChannelMembers} from '../model/voice-selectors';
import {MicOff, HeadphoneOff, LogOut} from 'lucide-react';
import type {User, VoicePresence} from '@/shared/types';
import {Slider} from '@/shared/ui/slider';
import type {Voice} from '../model/use-voice';
import {VoiceLevel} from './voice-level';
import {UserRow} from '@/entities/user';
import {useUserActions} from '@/shared/lib/user-actions';
import './voice-participants.css';

type Props = {
 voice: Voice;
 room: string;
 title: string;
 me?: User;
 users: User[];
 presence?: VoicePresence[];
 volumeForUser: (id: string) => number;
 setUserVolume: (id: string, volume: number) => void;
};

export function VoiceParticipants({voice, room, title, me, users, presence, volumeForUser, setUserVolume}: Props) {
 const actions = useUserActions();
 if (!me) return null;
 const joined = voice.room === room;
 const participants = selectVoiceChannelMembers(voice, room, me.id, presence);
 if (!participants.length) return null;
 return (
  <ul
   className="voice-channel-participants m-0 mt-0.5 mb-2 ml-7 list-none border-l border-l-[#ffffff16] py-0 pr-1 pl-2.5"
   aria-label={`Участники — ${title}`}
  >
   {participants.map(({id, self, muted, deaf}) => {
    const peer = joined && !self ? voice.peers.find(peer => peer.user === id && voice.streams[peer.client]) : undefined;
    const user = id === me.id ? me : users.find(user => user.id === id);
    const name = user?.name || 'Участник';
    const canAdjustVolume = self || id !== me.id;
    const volume = self ? voice.micVolume : volumeForUser(id);
    const volumeLabel = self ? 'Громкость микрофона' : 'Громкость пользователя';
    const actions_ = self ? [{label: 'Выйти из голосовой комнаты', icon: LogOut, onSelect: voice.leave}] : undefined;
    const controls = canAdjustVolume && (
     <div className="w-52 px-2 py-2" data-slot="participant-volume">
      <div className="mb-2 flex items-center justify-between gap-2 text-xs">
       <span>{volumeLabel}</span>
       <span className="tabular-nums">{volume}%</span>
      </div>
      <Slider
       aria-label={volumeLabel}
       min={0}
       max={200}
       value={[volume]}
       onValueChange={([value]) => (self ? voice.setMicVolume(value) : setUserVolume(id, value))}
      />
     </div>
    );
    return (
     <UserRow
      key={id}
      as="li"
      variant="voice"
      className="voice-channel-participant [&_svg]:shrink-0"
      identity={user ?? {id, name}}
      title={name}
      meta={self ? <small>Вы</small> : null}
      controls={controls}
      actions={actions_}
      adornment={
       joined ? (
        <VoiceLevel
         stream={self ? voice.local : peer ? voice.streams[peer.client] : undefined}
         muted={!!(muted || deaf)}
         name={name}
        />
       ) : null
      }
      trailing={
       <>
        {(muted || deaf) && (
         <TooltipLabel content="Микрофон выключен">
          <span>
           <MicOff size={14} role="img" aria-label="Микрофон выключен" aria-hidden={false} />
          </span>
         </TooltipLabel>
        )}
        {deaf && (
         <TooltipLabel content="Звук выключен">
          <span>
           <HeadphoneOff size={14} role="img" aria-label="Звук выключен" aria-hidden={false} />
          </span>
         </TooltipLabel>
        )}
       </>
      }
      onClick={() => actions?.openProfile(id)}
     />
    );
   })}
  </ul>
 );
}
