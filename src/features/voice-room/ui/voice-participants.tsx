import {MicOff,HeadphoneOff,LogOut} from 'lucide-react';
import type {User,VoicePresence} from '@/shared/api/backend';
import {Slider} from '@/shared/ui/slider';
import type {Voice} from '../model/use-voice';
import {VoiceLevel} from './voice-level';
import {UserRow} from '@/entities/user';
import {useUserActions} from '@/shared/lib/user-actions';
import './voice-participants.css';

type Props={
 voice:Voice;
 room:string;
 title:string;
 me?:User;
 users:User[];
 presence?:VoicePresence[];
 volumeForUser:(id:string)=>number;
 setUserVolume:(id:string,volume:number)=>void;
 canRequestFriend:(id:string)=>boolean;
 requestFriend:(id:string)=>void;
};

export function VoiceParticipants({voice,room,title,me,users,presence,volumeForUser,setUserVolume,canRequestFriend,requestFriend}:Props){
 const actions=useUserActions();
 if(!me)return null;
 const joined=voice.room===room;
 const participants=joined?[
  {key:'self',id:me.id,user:me,self:true,muted:voice.muted,deaf:voice.deaf},
  ...voice.peers.map(peer=>({key:peer.client,id:peer.user,user:users.find(user=>user.id===peer.user),self:false,muted:peer.muted,deaf:peer.deaf})),
 ]:(presence??[]).map(peer=>({key:peer.user,id:peer.user,user:users.find(user=>user.id===peer.user),self:false,muted:peer.muted,deaf:peer.deaf}));
 if(!participants.length)return null;
 return <ul className="voice-channel-participants" aria-label={`Участники — ${title}`}>
  {participants.map(({key,id,user,self,muted,deaf})=>{
   const name=user?.name||'Участник';
   const canAdjustVolume=self||id!==me.id;
   const volume=self?voice.micVolume:volumeForUser(id);
   const volumeLabel=self?'Громкость микрофона':'Громкость пользователя';
   const actions_=self
    ? [{label:'Выйти из голосовой комнаты',icon:LogOut,onSelect:voice.leave}]
    : undefined;
   const controls=canAdjustVolume&&<div className="w-52 px-2 py-2" data-slot="participant-volume">
    <div className="mb-2 flex items-center justify-between gap-2 text-xs">
     <span>{volumeLabel}</span><span className="tabular-nums">{volume}%</span>
    </div>
    <Slider
     aria-label={volumeLabel}
     min={0}
     max={200}
     value={[volume]}
     onValueChange={([value])=>self?voice.setMicVolume(value):setUserVolume(id,value)}
    />
   </div>;
   return <UserRow
    key={key}
    as="li"
    variant="voice"
    className="voice-channel-participant"
    identity={user??{id,name}}
    title={name}
    meta={self?<small>Вы</small>:null}
    controls={controls}
    actions={actions_}
    adornment={joined?<VoiceLevel stream={self?voice.local:voice.streams[key]} muted={!!(muted||deaf)} name={name}/>:null}
    trailing={<>
     {(muted||deaf)&&<span title="Микрофон выключен"><MicOff size={14} role="img" aria-label="Микрофон выключен" aria-hidden={false}/></span>}
     {deaf&&<span title="Звук выключен"><HeadphoneOff size={14} role="img" aria-label="Звук выключен" aria-hidden={false}/></span>}
    </>}
    onClick={()=>actions?.openProfile(id)}
   />;
  })}
 </ul>;
}
