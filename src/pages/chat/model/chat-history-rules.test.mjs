// Правила истории канала: склейка страниц, состояние кнопки, ошибки и курсор.
// Тест читает только чистые функции: сети, DOM и React в chat-history-rules.ts нет.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
 HISTORY_CURSOR_INVALID,
 HISTORY_PAGE_LIMIT,
 HISTORY_PAGE_LIMIT_MAX,
 HISTORY_PAGE_LIMIT_MIN,
 canLoadOlder,
 historyButtonVisible,
 historyErrorText,
 historyLimit,
 historyLoadingVisible,
 historyRetryVisible,
 historyTruncated,
 isHistoryCursorInvalid,
 mergeHistoryMessages,
 prependHistoryPage
} from './chat-history-rules.ts';

const message = (id, channel = 'c1', text = id) => ({id, channel, user: 'u1', text, time: 1});

test('страница встаёт перед загруженными сообщениями и не дублирует их', () => {
 const loaded = [message('m3'), message('m4')];
 const page = [message('m1'), message('m2'), message('m3')];
 assert.deepEqual(
  prependHistoryPage(loaded, page).map(item => item.id),
  ['m1', 'm2', 'm3', 'm4']
 );
 assert.deepEqual(
  loaded.map(item => item.id),
  ['m3', 'm4'],
  'входной список не меняется'
 );
});

test('дубли внутри страницы и пустая страница не ломают порядок', () => {
 assert.deepEqual(
  prependHistoryPage([message('m3')], [message('m1'), message('m2'), message('m2')]).map(item => item.id),
  ['m1', 'm2', 'm3']
 );
 assert.deepEqual(
  prependHistoryPage([message('m1')], []).map(item => item.id),
  ['m1']
 );
 assert.deepEqual(
  prependHistoryPage([message('m1')], [message('m1')]).map(item => item.id),
  ['m1']
 );
});

test('серверные сообщения идут после истории, а свежая копия побеждает по id', () => {
 const history = [message('m1'), message('m2', 'c1', 'старый текст')];
 const server = [message('m2', 'c1', 'новый текст'), message('m3')];
 const merged = mergeHistoryMessages(history, server);
 assert.deepEqual(
  merged.map(item => item.id),
  ['m1', 'm2', 'm3']
 );
 assert.equal(merged[1].text, 'новый текст');
 assert.equal(merged[0].text, 'm1');
});

test('лимит страницы: по умолчанию 50, вне диапазона зажимается в 1–100', () => {
 assert.equal(historyLimit(), HISTORY_PAGE_LIMIT);
 assert.equal(historyLimit(undefined), HISTORY_PAGE_LIMIT);
 assert.equal(historyLimit(Number.NaN), HISTORY_PAGE_LIMIT);
 assert.equal(historyLimit(Number.POSITIVE_INFINITY), HISTORY_PAGE_LIMIT);
 assert.equal(historyLimit(0), HISTORY_PAGE_LIMIT_MIN);
 assert.equal(historyLimit(-10), HISTORY_PAGE_LIMIT_MIN);
 assert.equal(historyLimit(10_000), HISTORY_PAGE_LIMIT_MAX);
 assert.equal(historyLimit(25), 25);
 assert.equal(historyLimit(25.9), 25);
});

test('устаревший курсор распознаётся и в ошибке, и в строке', () => {
 assert.equal(isHistoryCursorInvalid(new Error(HISTORY_CURSOR_INVALID)), true);
 assert.equal(isHistoryCursorInvalid(HISTORY_CURSOR_INVALID), true);
 assert.equal(isHistoryCursorInvalid(`Ответ сервера: ${HISTORY_CURSOR_INVALID}`), true);
 assert.equal(isHistoryCursorInvalid(new Error('Нет доступа к чату')), false);
 assert.equal(isHistoryCursorInvalid(''), false);
 assert.equal(isHistoryCursorInvalid(undefined), false);
});

test('кнопка видна только когда есть что грузить и нет загрузки или ошибки', () => {
 const idle = {hasMore: true, loading: false, error: ''};
 assert.equal(historyButtonVisible(idle), true);
 assert.equal(historyButtonVisible({...idle, loading: true}), false);
 assert.equal(historyButtonVisible({...idle, error: 'Сеть недоступна'}), false);
 assert.equal(historyButtonVisible({...idle, hasMore: false}), false);
});

test('строка «Загрузка…» и повтор не показываются одновременно', () => {
 assert.equal(historyLoadingVisible({hasMore: true, loading: true, error: ''}), true);
 assert.equal(historyLoadingVisible({hasMore: true, loading: false, error: ''}), false);
 assert.equal(historyRetryVisible({hasMore: true, loading: false, error: 'Сеть недоступна'}), true);
 assert.equal(historyRetryVisible({hasMore: true, loading: true, error: 'Сеть недоступна'}), false);
 assert.equal(historyRetryVisible({hasMore: true, loading: false, error: ''}), false);
});

test('текст ошибки объясняет, что именно не загрузилось', () => {
 assert.equal(historyErrorText(''), '');
 assert.equal(historyErrorText('Сеть недоступна'), 'Не удалось загрузить более ранние сообщения. Сеть недоступна');
 assert.match(historyErrorText(HISTORY_CURSOR_INVALID), /более ранние сообщения/);
});

test('автодогрузка включается только для обрезанного канала', () => {
 assert.equal(historyTruncated({historyTruncated: ['c1']}, 'c1'), true);
 assert.equal(historyTruncated({historyTruncated: ['c1']}, 'c2'), false);
 assert.equal(historyTruncated({historyTruncated: []}, 'c1'), false);
 assert.equal(historyTruncated({}, 'c1'), false);
 assert.equal(historyTruncated(null, 'c1'), false);
 assert.equal(historyTruncated({historyTruncated: ['c1']}, ''), false);
});

test('догрузка разрешена после ошибки, но не после конца истории', () => {
 assert.equal(canLoadOlder({loading: true, loaded: false, hasMore: true}), false);
 assert.equal(canLoadOlder({loading: false, loaded: false, hasMore: false}), true);
 assert.equal(canLoadOlder({loading: false, loaded: true, hasMore: true}), true);
 assert.equal(canLoadOlder({loading: false, loaded: true, hasMore: false}), false);
});
