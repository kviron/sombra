import type { User } from '@/shared/api/backend';
import { UserRow } from './user-row';
import { useUserActions } from './user-actions';

function byName(left: User, right: User) {
  return left.name.localeCompare(right.name, 'ru');
}

export function MemberList({ members, users, meId }: { members: string[]; users: User[]; meId: string }) {
  const actions = useUserActions();
  const people = members
    .map((id) => users.find((user) => user.id === id))
    .filter((user): user is User => !!user);
  const online = people.filter((user) => user.id === meId || user.online).sort(byName);
  const offline = people.filter((user) => user.id !== meId && !user.online).sort(byName);

  if (!people.length) return <p className="member-empty">В группе пока никого нет.</p>;

  return (
    <>
      {online.length > 0 && (
        <section className="member-section">
          <h3>В сети <span>— {online.length}</span></h3>
          <ul>
            {online.map((user) => (
              <UserRow
                key={user.id}
                as="li"
                variant="member"
                identity={user}
                meta={user.id === meId ? <small>Вы</small> : null}
                title={user.bio || user.name}
                onClick={() => actions?.openProfile(user.id)}
              />
            ))}
          </ul>
        </section>
      )}
      {offline.length > 0 && (
        <section className="member-section">
          <h3>Не в сети <span>— {offline.length}</span></h3>
          <ul>
            {offline.map((user) => (
              <UserRow
                key={user.id}
                as="li"
                variant="member"
                identity={user}
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
