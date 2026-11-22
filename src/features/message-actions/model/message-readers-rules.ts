// Чистые правила просмотров сообщения: кому они доступны и как показать список.
// Сеть, DOM и React здесь не нужны, поэтому правила проверяются тестами.
export type MessageReader = {user: string; seenAt: number};

/** Просмотры видит только автор сообщения и только на сервере с подтверждениями чтения. */
export function readersAvailable(readReceiptsSupported: boolean | undefined, author: string, me: string) {
 return readReceiptsSupported === true && author === me;
}

/** Себя в списке просмотревших не показываем. */
export function withoutAuthor(readers: MessageReader[], owner: string) {
 return readers.filter(reader => reader.user !== owner);
}

/** Машинное время для атрибута `datetime`. */
export function seenAtIso(seenAt: number) {
 return new Date(seenAt * 1000).toISOString();
}

/** Подпись времени просмотра в русской локали. */
export function seenAtLabel(seenAt: number) {
 return new Date(seenAt * 1000).toLocaleString('ru', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit'
 });
}

export function readersError(reason: unknown) {
 return reason instanceof Error ? reason.message : 'Не удалось загрузить просмотры';
}
