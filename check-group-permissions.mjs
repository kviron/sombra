import assert from 'node:assert/strict';
import {canGroup,hasGroupManagement,GROUP_PERMISSIONS,GROUP_PERMISSION_CATALOG,DEFAULT_MEMBER_ROLE,DEFAULT_ADMIN_ROLE,getGroupRoles} from './ui/shared/lib/group-permissions.ts';
const base={id:'g',name:'Group',owner:'owner',invite:'x',members:['owner','member'],channels:[]};
let checks=0;
function check(actual,expected){assert.deepEqual(actual,expected);checks++;}
check(GROUP_PERMISSIONS.length,12);check(new Set(GROUP_PERMISSIONS).size,12);
check(GROUP_PERMISSIONS,[ 'group.rename','group.avatar','channels.create_text','channels.create_voice','channels.rename','channels.delete','members.invite','invite.rotate','members.kick','messages.delete_any','stickers.manage','bots.manage' ]);
for(const permission of GROUP_PERMISSIONS){check(canGroup(base,'owner',permission),true);check(canGroup(base,'member',permission),false);check(canGroup({...base,permissions:[permission]},'member',permission),true);check(canGroup({...base,permissions:[permission]},'outsider',permission),false);check(canGroup({...base,permissions:[]},'owner',permission),true);}
check(canGroup({...base,members:['member']},'owner','group.rename'),false);
check(canGroup(null,'owner','group.rename'),false);
check(canGroup({...base,roles:[{id:'admin',name:'Admin',permissions:[...GROUP_PERMISSIONS]}],memberRoles:{member:'admin'},permissions:[]},'member','group.rename'),false);
check(canGroup({...base,roles:[{id:'admin',name:'Admin',permissions:[...GROUP_PERMISSIONS]}],memberRoles:{member:'admin'}},'member','group.rename'),false);
check(hasGroupManagement(base,'owner'),true);check(hasGroupManagement(base,'member'),false);check(hasGroupManagement({...base,permissions:['bots.manage']},'member'),true);check(hasGroupManagement({...base,permissions:GROUP_PERMISSIONS},'outsider'),false);
check(DEFAULT_MEMBER_ROLE.id,'member');check(DEFAULT_MEMBER_ROLE.permissions,[]);check(Object.isFrozen(DEFAULT_MEMBER_ROLE),true);check(Object.isFrozen(DEFAULT_MEMBER_ROLE.permissions),true);check(DEFAULT_ADMIN_ROLE.permissions,GROUP_PERMISSIONS);
check(getGroupRoles(base).map(role=>role.id),['member','admin']);check(getGroupRoles({...base,roles:[]}).map(role=>role.id),['member']);
check(getGroupRoles({...base,roles:[{id:'member',name:'Hacked',permissions:['bots.manage']}]}),[{id:'member',name:'Участник',permissions:[]}]);
check(GROUP_PERMISSION_CATALOG.every(section=>section.items.every(item=>item.label&&item.description)),true);
console.log(`Group permission helper: ${checks} checks passed.`);
