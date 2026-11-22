import {useEffect,useState} from 'react';
import type {User} from '@/shared/types';
import {UserAvatar} from '@/shared/ui/user-avatar';
import {peerStatus} from '../model/dm-header-status';
import './dm-header-identity.css';
export function DmHeaderIdentity({user,typingUntil=0}:{user:User;typingUntil?:number}){
 const [,setNow]=useState(Date.now());
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),30000);return()=>clearInterval(timer)},[user.id]);
 useEffect(()=>{const remaining=typingUntil*1000-Date.now();if(!Number.isFinite(remaining)||remaining<=0)return;const timer=setTimeout(()=>setNow(Date.now()),Math.min(remaining+10,2147483647));return()=>clearTimeout(timer)},[typingUntil,user.id]);
 const now=Date.now(),typing=typingUntil*1000>now;
 return <><UserAvatar user={user} size="sm" presence={!user.bot} decorative decoration={user.decorations?.avatar}/><span className="dm-header-label"><strong>{user.name}</strong><small className={typing?'dm-header-typing':undefined} role="status" aria-live="polite">{peerStatus(user,typingUntil,now)}</small></span></>;
}
