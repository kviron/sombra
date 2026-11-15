import {MicOff,Headphones} from 'lucide-react';
import type {User} from '@/shared/api/backend';
import type {Voice} from './use-voice';
import {VoiceLevel} from './voice-level';
import './voice-participants.css';
export function VoiceParticipants({voice,room,title,me,users}:{voice:Voice;room:string;title:string;me?:User;users:User[]}){
 if(voice.room!==room||!me)return null;
 const participants=[{key:'self',user:me,self:true},...voice.peers.map(peer=>({key:peer.client,user:users.find(user=>user.id===peer.user),self:false}))];
 return <ul className="voice-channel-participants" aria-label={`Участники — ${title}`}>
  {participants.map(({key,user,self})=><li className="voice-channel-participant" key={key} title={user?.name||'Участник'}>
   <span className="voice-channel-avatar" aria-hidden="true">{user?.avatar?<img src={user.avatar} alt=""/>:user?.name[0]||'?'}</span>
   <VoiceLevel stream={self?voice.local:voice.streams[key]} muted={self&&(voice.muted||voice.deaf)} name={user?.name||'Участник'}/>
   <span className="voice-channel-name">{user?.name||'Участник'}</span>
   {self&&<small>Вы</small>}
   {self&&(voice.muted||voice.deaf)&&<MicOff size={14} aria-label="Микрофон выключен"/>}
   {self&&voice.deaf&&<Headphones size={14} aria-label="Звук выключен"/>}
  </li>)}
 </ul>;
}
