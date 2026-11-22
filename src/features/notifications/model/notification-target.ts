import type {ChatState} from '@/shared/types';
export type NotificationTarget={account:string;channel:string;message:string};
export type NotificationRoute={home:boolean;channel:string;group?:string;message?:string};
export function validNotificationTarget(value:unknown):value is NotificationTarget{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const v=value as Record<string,unknown>;
 return Object.keys(v).length===3&&['account','channel','message'].every(key=>typeof v[key]==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v[key] as string));
}
export function notificationRoute(state:ChatState,target:NotificationTarget):NotificationRoute|null{
 if(!validNotificationTarget(target)||state.me.id!==target.account)return null;
 const dialog=state.dialogs.find(d=>d.id===target.channel&&d.members.includes(state.me.id));
 const group=state.groups.find(g=>g.members.includes(state.me.id)&&g.channels.some(c=>c.id===target.channel));
 if(!dialog&&!group)return null;
 const message=state.messages.some(m=>m.id===target.message&&m.channel===target.channel)?target.message:undefined;
 return {home:!!dialog,channel:target.channel,group:dialog?undefined:group!.id,message};
}
