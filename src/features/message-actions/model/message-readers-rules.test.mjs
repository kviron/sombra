// Правила просмотров: доступность, фильтрация себя и подписи времени.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readersAvailable, readersError, seenAtIso, seenAtLabel, withoutAuthor} from './message-readers-rules.ts';

const readers = [
 {user: 'me', seenAt: 1700000000},
 {user: 'a', seenAt: 1700000100},
 {user: 'b', seenAt: 1700000200}
];

test('просмотры доступны только автору и только при поддержке сервера', () => {
 assert.equal(readersAvailable(true, 'me', 'me'), true);
 assert.equal(readersAvailable(true, 'a', 'me'), false, 'чужие сообщения не раскрываются');
 assert.equal(readersAvailable(false, 'me', 'me'), false);
 assert.equal(readersAvailable(undefined, 'me', 'me'), false);
});

test('себя в списке просмотревших не показываем', () => {
 assert.deepEqual(
  withoutAuthor(readers, 'me').map(reader => reader.user),
  ['a', 'b']
 );
 assert.deepEqual(withoutAuthor([], 'me'), []);
});

test('время просмотра отдаётся в ISO и человеческой подписи', () => {
 assert.equal(seenAtIso(1700000000), '2023-11-14T22:13:20.000Z');
 assert.match(seenAtLabel(1700000000), /^\d{1,2} нояб\., \d{2}:\d{2}$/);
 assert.notEqual(seenAtLabel(1700000000), seenAtIso(1700000000));
});

test('ошибка загрузки берётся из исключения с запасным текстом', () => {
 assert.equal(readersError(new Error('Нет сети')), 'Нет сети');
 assert.equal(readersError('строка'), 'Не удалось загрузить просмотры');
});
