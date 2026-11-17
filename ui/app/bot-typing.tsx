import {useEffect,useState} from 'react';
import type {ChatState} from '@/shared/api/backend';
import './bot-typing.css';
export function typingBotNames(state:Pick<ChatState,'botTyping'|'users'>,channel:string,now=Date.now()/1000):string[]{
 const ids=new Set((state.botTyping||[]).filter(item=>item.channel===channel&&Number.isFinite(item.until)&&item.until>now).map(item=>item.bot));
 return state.users.filter(user=>user.bot&&ids.has(user.id)).map(user=>user.name);
}
export function BotTyping({state,channel}:{state:ChatState;channel:string}){
 const [now,setNow]=useState(()=>Date.now()/1000);
 useEffect(()=>{setNow(Date.now()/1000);const timer=setInterval(()=>setNow(Date.now()/1000),1000);return()=>clearInterval(timer)},[channel,state.botTyping]);
 const names=typingBotNames(state,channel,now);
 if(!names.length)return null;
 return <div className="bot-typing" role="status" aria-live="polite" aria-atomic="true">{names.join(', ')} {names.length===1?'печатает…':'печатают…'}</div>;
}
