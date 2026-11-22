import type {User} from '@/shared/api/backend';
function plural(value:number,forms:readonly [string,string,string]):string{
 const tail=value%100,last=value%10;
 return tail>=11&&tail<=14?forms[2]:last===1?forms[0]:last>=2&&last<=4?forms[1]:forms[2];
}
/** Approximate elapsed units: months are 30 days, years are 365 days. */
export function lastActivity(seen:number|undefined,now=Date.now()):string{
 if(!seen||!Number.isFinite(seen)||seen<=0||!Number.isFinite(now)||seen*1000>now+60000)return 'Не в сети';
 const seconds=Math.max(0,Math.floor((now-seen*1000)/1000));
 if(seconds<60)return 'Был недавно';
 const units:readonly [number,readonly [string,string,string],boolean][]=[
  [365*86400,['год','года','лет'],true],
  [30*86400,['месяц','месяца','месяцев'],true],
  [86400,['день','дня','дней'],false],
  [3600,['час','часа','часов'],false],
  [60,['минуту','минуты','минут'],false],
 ];
 const [size,forms,longAgo]=units.find(([size])=>seconds>=size)!;
 const amount=Math.floor(seconds/size);
 return `${longAgo?'Заходил':'Был'} ${amount===1?'':amount+' '}${plural(amount,forms)} назад`;
}
export function peerStatus(user:Pick<User,'online'|'last_seen'|'bot'>,typingUntil=0,now=Date.now()):string{
 if(Number.isFinite(typingUntil)&&typingUntil*1000>now)return 'печатает…';
 if(user.bot)return 'Бот';
 if(user.online)return 'В сети';
 return lastActivity(user.last_seen,now);
}
