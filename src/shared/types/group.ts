export type Channel = {id:string;name:string;kind:string;unreadCount?:number;unreadMentionCount?:number};
export type GroupPermission = 'group.rename' | 'group.avatar' | 'channels.create_text' | 'channels.create_voice' | 'channels.rename' | 'channels.delete' | 'members.invite' | 'invite.rotate' | 'members.kick' | 'messages.delete_any' | 'stickers.manage' | 'bots.manage';
export type GroupRole = {id:string;name:string;permissions:GroupPermission[]};
export type Group = {id:string;name:string;owner:string;invite:string;members:string[];channels:Channel[];avatar?:string;avatarHash?:string;roles?:GroupRole[];memberRoles?:Record<string,string>;rolesRevision?:number;membersCanInvite?:boolean;permissions?:GroupPermission[]};
