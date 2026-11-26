import {BubbleReactions} from '@/shared/ui/bubble';
import {Button} from '@/shared/ui/button';
import {UserAvatar} from '@/shared/ui/user-avatar';
import type {User} from '@/shared/types';
import type {ReactionView} from '../model/message-item-rules';

export function MessageReactions({
 reactions,
 me,
 users,
 busy,
 onReact
}: {
 reactions: ReactionView[];
 me: User;
 users: User[];
 busy: boolean;
 onReact: (emoji: string) => void;
}) {
 return (
  <BubbleReactions side="inline" aria-label="Реакции" role="group">
   {reactions.map(({emoji, count, pressed, reactors}) => {
    const people = reactors.flatMap(id => {
     const user = id === me.id ? me : users.find(item => item.id === id);
     return user ? [user] : [];
    });
    return (
     <Button
      type="button"
      size="xs"
      variant="ghost"
      className="message-reaction"
      disabled={busy}
      aria-label={`Реакция ${emoji}, ${count}`}
      aria-pressed={pressed}
      key={emoji}
      onClick={() => onReact(emoji)}
     >
      {emoji}
      {people.length === count ? (
       <span className="flex [&>*+*]:-ml-1" aria-hidden="true">
        {people.map(user => (
         <UserAvatar
          key={user.id}
          user={user}
          size="xs"
          decorative
          presence={false}
          effectAsset={null}
          className="data-[size=xs]:[--avatar-size:14px]"
         />
        ))}
       </span>
      ) : count > 1 ? (
       <span>{count}</span>
      ) : null}
     </Button>
    );
   })}
  </BubbleReactions>
 );
}
