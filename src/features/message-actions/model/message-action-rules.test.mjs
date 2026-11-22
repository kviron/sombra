// Правила правки и удаления сообщения: длины, права на «для всех» и готовность к отправке.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
 MESSAGE_TEXT_LIMIT,
 actionError,
 canSaveEdit,
 canSubmit,
 deleteDescription,
 mayDeleteForEveryone,
 removeForEveryone,
 textTooLong
} from './message-action-rules.ts';

test('удалить для всех может автор или обладатель права', () => {
 assert.equal(mayDeleteForEveryone(true, false), true);
 assert.equal(mayDeleteForEveryone(false, true), true);
 assert.equal(mayDeleteForEveryone(false, false), false);
 assert.equal(removeForEveryone(true, true), true);
 assert.equal(removeForEveryone(true, false), false);
 assert.equal(removeForEveryone(false, true), false, 'без права флаг ничего не включает');
});

test('длина текста считается по символам, пробелы по краям не в счёт', () => {
 assert.equal(textTooLong('я'.repeat(MESSAGE_TEXT_LIMIT)), false);
 assert.equal(textTooLong('я'.repeat(MESSAGE_TEXT_LIMIT + 1)), true);
 assert.equal(textTooLong(` ${'я'.repeat(MESSAGE_TEXT_LIMIT)} `), false);
 assert.equal(textTooLong('👋'.repeat(MESSAGE_TEXT_LIMIT)), false, 'эмодзи — один символ');
});

test('сохранить правку можно только при изменённом непустом тексте', () => {
 assert.equal(canSaveEdit('Привет', 'Привет'), false, 'ничего не изменено');
 assert.equal(canSaveEdit(' Привет ', 'Привет'), false, 'пробелы не считаются правкой');
 assert.equal(canSaveEdit('Пока', 'Привет'), true);
 assert.equal(canSaveEdit('   ', 'Привет'), false);
 assert.equal(canSaveEdit('я'.repeat(MESSAGE_TEXT_LIMIT + 1), 'Привет'), false);
});

test('отправка запрещена во время запроса, а удаление готово всегда', () => {
 assert.equal(canSubmit('edit', true, 'Новое', 'Старое'), false);
 assert.equal(canSubmit('edit', false, 'Старое', 'Старое'), false);
 assert.equal(canSubmit('edit', false, 'Новое', 'Старое'), true);
 assert.equal(canSubmit('delete', true, '', 'Старое'), false);
 assert.equal(canSubmit('delete', false, '', 'Старое'), true);
});

test('описание удаления зависит от выбранного флага', () => {
 assert.equal(deleteDescription(true), 'Сообщение исчезнет у всех участников чата.');
 assert.equal(deleteDescription(false), 'Сообщение исчезнет только у вас.');
});

test('ошибка берётся из исключения, а не из разметки', () => {
 assert.equal(actionError(new Error('Нет сети')), 'Нет сети');
 assert.equal(actionError('строка'), '');
});
