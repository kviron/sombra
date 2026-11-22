import type { Group, GroupPermission, GroupRole } from '@/shared/types';

export const GROUP_PERMISSION_CATALOG: {group:string;items:{key:GroupPermission;label:string;description:string}[]}[] = [
 {group:'Группа',items:[{key:'group.rename',label:'Название группы',description:'Изменять название группы.'},{key:'group.avatar',label:'Аватар группы',description:'Менять и удалять изображение группы.'}]},
 {group:'Каналы',items:[{key:'channels.create_text',label:'Текстовые каналы',description:'Создавать текстовые каналы.'},{key:'channels.create_voice',label:'Голосовые каналы',description:'Создавать голосовые каналы.'},{key:'channels.rename',label:'Названия каналов',description:'Переименовывать каналы.'},{key:'channels.delete',label:'Удаление каналов',description:'Удалять каналы вместе с их содержимым.'}]},
 {group:'Участники',items:[{key:'members.invite',label:'Приглашение участников',description:'Добавлять участников по email, просматривать и копировать код приглашения.'},{key:'invite.rotate',label:'Новая ссылка приглашения',description:'Заменять ссылку, отключая старую.'},{key:'members.kick',label:'Исключение участников',description:'Исключать участников, кроме владельца.'}]},
 {group:'Контент и интеграции',items:[{key:'messages.delete_any',label:'Чужие сообщения',description:'Удалять сообщения других участников.'},{key:'stickers.manage',label:'Стикеры группы',description:'Управлять набором стикеров группы.'},{key:'bots.manage',label:'Боты группы',description:'Добавлять и удалять ботов группы.'}]},
];
export const GROUP_PERMISSIONS: GroupPermission[] = GROUP_PERMISSION_CATALOG.flatMap(section=>section.items.map(item=>item.key));
export const GROUP_ACTION_PERMISSIONS = Object.freeze({rename_group:'group.rename',set_group_avatar:'group.avatar',create_text_channel:'channels.create_text',create_voice_channel:'channels.create_voice',rename_channel:'channels.rename',delete_channel:'channels.delete',invite_member:'members.invite',rotate_invite:'invite.rotate',kick_member:'members.kick',delete_any_message:'messages.delete_any',manage_stickers:'stickers.manage',manage_bots:'bots.manage'} satisfies Record<string,GroupPermission>);
export const GROUP_MEMBERSHIP_ACTIONS = Object.freeze(['read','write','voice','edit_own_message','delete_own_message'] as const);
export const DEFAULT_MEMBER_ROLE = Object.freeze({id:'member',name:'Участник',permissions:Object.freeze([] as GroupPermission[])});
export const DEFAULT_ADMIN_ROLE = Object.freeze({id:'admin',name:'Администратор',permissions:Object.freeze([...GROUP_PERMISSIONS])});
/** Templates are display/edit seeds only, never effective authorization. */
export function getGroupRoles(group:Group):GroupRole[] {
 const roles = group.roles ?? [{...DEFAULT_MEMBER_ROLE,permissions:[]},{...DEFAULT_ADMIN_ROLE,permissions:[...GROUP_PERMISSIONS]}];
 return [{...DEFAULT_MEMBER_ROLE,permissions:[]},...roles.filter(role=>role.id!=='member').map(role=>({...role,permissions:[...role.permissions]}))];
}
export function canGroup(group:Group|undefined|null,userId:string,permission:GroupPermission):boolean {
 if(!group || !userId || !group.members.includes(userId)) return false;
 if(group.owner===userId) return true;
 // The DTO contains permissions for the current actor, not arbitrary raw roles.
 return Array.isArray(group.permissions) && group.permissions.includes(permission);
}
export function hasGroupManagement(group:Group|undefined|null,userId:string):boolean {
 return GROUP_PERMISSIONS.some(permission=>canGroup(group,userId,permission));
}
