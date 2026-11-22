// Чистые правила действий над сообщением: правка текста, удаление и тексты подсказок.
// Сеть, DOM и React здесь не нужны, поэтому правила проверяются тестами.
export const MESSAGE_TEXT_LIMIT = 2000;

/** Удалить у всех может автор или тот, кому разрешено удалять чужие сообщения. */
export function mayDeleteForEveryone(author: boolean, canDeleteEveryone: boolean) {
 return author || canDeleteEveryone;
}

export function removeForEveryone(mayDelete: boolean, forEveryone: boolean) {
 return mayDelete && forEveryone;
}

/** Длина считается по символам, а не по единицам UTF-16: эмодзи — один символ. */
export function textTooLong(text: string) {
 return [...text.trim()].length > MESSAGE_TEXT_LIMIT;
}

export function canSaveEdit(text: string, original: string) {
 const trimmed = text.trim();
 return !!trimmed && !textTooLong(text) && trimmed !== original;
}

/** Отправка возможна, пока не идёт запрос: для правки ещё нужен изменённый текст. */
export function canSubmit(mode: 'edit' | 'delete', busy: boolean, text: string, original: string) {
 return !busy && (mode !== 'edit' || canSaveEdit(text, original));
}

export function deleteDescription(forEveryone: boolean) {
 return forEveryone ? 'Сообщение исчезнет у всех участников чата.' : 'Сообщение исчезнет только у вас.';
}

export function actionError(reason: unknown) {
 return reason instanceof Error ? reason.message : '';
}
