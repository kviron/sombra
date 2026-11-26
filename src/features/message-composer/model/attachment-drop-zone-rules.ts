// Чистые правила перетаскивания файлов: что считается файлом и почему перенос отклонён.
// Файл намеренно не импортирует ничего, кроме типов: так его читает node --experimental-strip-types.

/** Структура DataTransfer, которой достаточно правилам: браузер отдаёт больше полей. */
export type DragTransfer = {
 types?: ArrayLike<string>;
 items?: ArrayLike<{kind?: string}>;
 files?: ArrayLike<unknown> | null;
};

/** У перетаскивания файла до сброса нет самих файлов, но тип Files объявлен. */
export function hasDraggedFiles(transfer: DragTransfer | null | undefined): boolean {
 return (
  !!transfer &&
  (Array.from(transfer.types || []).includes('Files') ||
   Array.from(transfer.items || []).some(item => item.kind === 'file') ||
   (transfer.files?.length ?? 0) > 0)
 );
}

export const acceptingDrops = (channel: string | undefined, disabled: boolean) => !!channel && !disabled;

export const dropOverlayVisible = (dragging: boolean, accepting: boolean) => dragging && accepting;

export const dropEffectFor = (accepting: boolean) => (accepting ? 'copy' : 'none');

export const isFileItem = (item: {kind?: string}) => item.kind === 'file';

/** Папку нельзя прочитать как один из файлов сообщения. */
export function dropError({directories, count}: {directories: boolean; count: number}) {
 if (directories) return 'Перетащите файл, а не папку.';
 if (count === 0) return 'Не удалось получить файл. Попробуйте кнопку вложения.';
 return '';
}
