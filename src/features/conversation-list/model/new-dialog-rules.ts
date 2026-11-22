// Чистые правила нового чата: кого показать, кого выбрать и что отправить на сервер.
// Сеть, DOM и React здесь не нужны, поэтому правила проверяются тестами.
import type {ChatState, User} from '@/shared/types';

/** Девять человек и вы — лимит личного чата в десять участников. */
export const NEW_DIALOG_MEMBER_LIMIT = 9;

/** Подтверждённая дружба: её строки в списке идут первыми. */
export function friendIds(state: ChatState) {
 const me = state.me.id;
 return new Set(
  state.friends
   .filter(friend => friend.accepted && (friend.from === me || friend.to === me))
   .map(friend => (friend.from === me ? friend.to : friend.from))
 );
}

/** Люди из общих групп: с ними тоже можно начать личный диалог. */
export function commonMemberIds(state: ChatState) {
 return new Set(state.groups.filter(group => group.members.includes(state.me.id)).flatMap(group => group.members));
}

/** Кандидаты без себя и без дублей: друзья и участники общих групп. */
export function dialogPeople(state: ChatState, friends: Set<string>, common: Set<string>) {
 return state.users.filter(
  (user, index, all) =>
   user.id !== state.me.id &&
   (friends.has(user.id) || common.has(user.id)) &&
   all.findIndex(other => other.id === user.id) === index
 );
}

export function selectedPeople(people: User[], selected: string[]) {
 return selected.map(userId => people.find(user => user.id === userId)).filter((user): user is User => !!user);
}

/** Поиск по имени: друзья идут первыми, внутри группы — по алфавиту. */
export function visiblePeople(people: User[], friends: Set<string>, query: string) {
 const search = query.trim().toLocaleLowerCase('ru');
 return people
  .filter(user => user.name.toLocaleLowerCase('ru').includes(search))
  .sort((a, b) => Number(friends.has(b.id)) - Number(friends.has(a.id)) || a.name.localeCompare(b.name, 'ru'));
}

/** Выбор по клику: лимит проверяет правило, а не разметка. */
export function toggleSelected(selected: string[], userId: string) {
 if (selected.includes(userId)) return selected.filter(value => value !== userId);
 return selected.length < NEW_DIALOG_MEMBER_LIMIT ? [...selected, userId] : selected;
}

/** Почему строку нельзя выбрать: лимит, уже выбранный бот или сам бот при выборе людей. */
export function memberUnavailable(user: User, selected: string[], selectedUsers: User[], locked: boolean) {
 return (
  locked ||
  (!selected.includes(user.id) &&
   (selected.length >= NEW_DIALOG_MEMBER_LIMIT ||
    selectedUsers.some(item => item.bot) ||
    (!!user.bot && selected.length > 0)))
 );
}

export function canSubmitSelection(selected: string[]) {
 return selected.length >= 1 && selected.length <= NEW_DIALOG_MEMBER_LIMIT;
}

export function limitNote(count: number) {
 return count === NEW_DIALOG_MEMBER_LIMIT ? ' · Достигнут лимит участников' : ' · До 10 участников вместе с вами';
}

export function emptyPeopleText(query: string) {
 return query.trim()
  ? 'Никого не нашли. Попробуйте другое имя.'
  : 'Здесь появятся ваши друзья и участники общих групп.';
}

/** Имя группы берётся из поля или из имён выбранных; личный диалог имени не отправляет. */
export function newDialogPayload(selected: string[], selectedUsers: User[], name: string) {
 const titled = selected.length > 1;
 return {
  members: selected,
  ...(titled
   ? {
      name:
       name.trim() ||
       selectedUsers
        .map(user => user.name)
        .join(', ')
        .slice(0, 60)
     }
   : {})
 };
}

type SubmitLabelArgs = {busy: boolean; created: boolean; error: string; count: number};

/** Подпись кнопки отправки: состояние операции важнее количества выбранных. */
export function submitLabel({busy, created, error, count}: SubmitLabelArgs) {
 if (busy) return 'Создаём…';
 if (created) return 'Повторить обновление';
 if (error) return 'Попробовать снова';
 return count > 1 ? 'Создать группу' : 'Создать чат';
}

/** Ошибка обновления списка после успешного создания не скрывает сам успех. */
export function errorText(created: boolean, error: string) {
 return created ? `Чат создан, но не удалось обновить список. Повторите обновление. ${error}` : error;
}
