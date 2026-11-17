import type {User} from '@/shared/api/backend';
export function peerStatus(user:Pick<User,'online'|'last_seen'|'bot'>,typingUntil=0,now=Date.now()):string{
 if(Number.isFinite(typingUntil)&&typingUntil*1000>now)return 'печатает…';
 if(user.bot)return 'Бот';
 if(user.online)return 'В сети';
 const seen=user.last_seen;
 if(!seen||!Number.isFinite(seen)||seen<=0||seen*1000>now+60000)return 'Не в сети';
 if(now-seen*1000<60000)return 'Был(а) только что';
 const date=new Date(seen*1000),today=new Date(now);
 return date.toDateString()===today.toDateString()?`Был(а) сегодня в ${date.toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'})}`:`Был(а) ${date.toLocaleString('ru',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}`;
}
