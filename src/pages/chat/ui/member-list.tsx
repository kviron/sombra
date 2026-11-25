import {TooltipLabel} from '@/shared/ui/tooltip';
import type {User, Group} from '@/shared/types';
import {UserRow} from '@/entities/user';
import {useUserActions} from '@/shared/lib/user-actions';
import {getGroupRoles} from '@/entities/group';
import './group-member-roles.css';

function byName(left: User, right: User) {
 return left.name.localeCompare(right.name, 'ru');
}

export function MemberList({
 members,
 users,
 meId,
 group
}: {
 members: string[];
 users: User[];
 meId: string;
 group?: Group;
}) {
 const roles = group ? getGroupRoles(group) : [];
 const roleName = (user: User) =>
  user.bot
   ? 'Бот'
   : group?.owner === user.id
     ? 'Владелец'
     : roles.find(role => role.id === (group?.memberRoles?.[user.id] || 'member'))?.name || 'Участник';
 const roleBadge = (user: User) => (
  <TooltipLabel content={roleName(user)}>
   <small className="group-member-role">
    {user.id === meId ? 'Вы · ' : ''}
    {roleName(user)}
   </small>
  </TooltipLabel>
 );
 const actions = useUserActions();
 const people = members.map(id => users.find(user => user.id === id)).filter((user): user is User => !!user);
 const online = people.filter(user => user.id === meId || user.online).sort(byName);
 const offline = people.filter(user => user.id !== meId && !user.online).sort(byName);

 if (!people.length) return <p className="member-empty">В группе пока никого нет.</p>;

 return (
  <>
   {online.length > 0 && (
    <section className="member-section">
     <h3>
      В сети <span>— {online.length}</span>
     </h3>
     <ul>
      {online.map(user => (
       <UserRow
        key={user.id}
        as="li"
        variant="member"
        identity={user}
        meta={roleBadge(user)}
        title={user.bio || user.name}
        onClick={() => actions?.openProfile(user.id)}
       />
      ))}
     </ul>
    </section>
   )}
   {offline.length > 0 && (
    <section className="member-section">
     <h3>
      Не в сети <span>— {offline.length}</span>
     </h3>
     <ul>
      {offline.map(user => (
       <UserRow
        key={user.id}
        as="li"
        variant="member"
        identity={user}
        meta={roleBadge(user)}
        title={user.bio || user.name}
        onClick={() => actions?.openProfile(user.id)}
       />
      ))}
     </ul>
    </section>
   )}
  </>
 );
}
