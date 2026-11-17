import {useEffect,useState} from 'react';
import type {User} from '@/shared/api/backend';
import {UserAvatar} from '@/shared/ui/user-avatar';
import {peerStatus} from './dm-header-status';
import './dm-header-identity.css';
export function DmHeaderIdentity({user,typingUntil=0}:{user:User;typingUntil?:number}){
 const [,setNow]=useState(Date.now());
 useEffect(()=>{setNow(Date.now());if(!typingUntil)return;const timer=setInterval(()=>setNow(Date.now()),250);return()=>clearInterval(timer)},[typingUntil,user.id]);
 const now=Date.now(),typing=typingUntil*1000>now;
 return <><UserAvatar user={user} size="sm" presence={!user.bot} decorative/><span className="dm-header-label"><strong>{user.name}</strong><small className={typing?'dm-header-typing':undefined} role="status" aria-live="polite">{peerStatus(user,typingUntil,now)}</small></span></>;
}
