// Правила журнала: подписи записей, тело деталей, экспорт и порядок строк.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {categoryLabel, entryDetails, entryLabel, journalExportText, newestFirst} from './diagnostic-journal-rules.ts';

const entry = (time, operation, category, status = null) => ({time, source: 'desktop', operation, category, status});

test('известная категория получает подпись, неизвестная — общую', () => {
 assert.equal(categoryLabel('timeout'), 'Время ожидания истекло');
 assert.equal(categoryLabel('render_error'), 'Экран остановился из-за ошибки');
 assert.equal(categoryLabel('unknown'), 'Диагностическое событие');
 assert.equal(entryLabel('voice_transport', 'ice_connected'), 'Голосовое соединение установлено');
 assert.equal(entryLabel('voice_transport', 'path_relay'), 'Звук через ретранслятор');
});

test('операция важнее категории, иначе показывается категория', () => {
 assert.equal(entryLabel('voice_poll', 'timeout'), 'Не удалось обновить состояние голосовой комнаты');
 assert.equal(entryLabel('state', 'transport'), 'Не удалось загрузить состояние приложения');
 assert.equal(entryLabel('unknown_operation', 'http_error'), 'Ошибка HTTP');
});

test('детали записи содержат только безопасные поля', () => {
 assert.deepEqual(entryDetails({operation: 'state', category: 'transport', status: 502}), {
  source: 'desktop',
  operation: 'state',
  category: 'transport',
  status: 502
 });
});

test('экспорт — NDJSON по одной записи в строке с финальным переводом', () => {
 const text = journalExportText([entry(1, 'state', 'transport', 500), entry(2, 'voice_poll', 'timeout')]);
 assert.equal(
  text,
  '{"time":1,"source":"desktop","operation":"state","category":"transport","status":500}\n' +
   '{"time":2,"source":"desktop","operation":"voice_poll","category":"timeout","status":null}\n'
 );
 assert.equal(journalExportText([]), '\n');
});

test('свежие записи показываются сверху, исходный список не меняется', () => {
 const entries = [entry(1, 'state', 'transport'), entry(2, 'state', 'timeout')];
 assert.deepEqual(
  newestFirst(entries).map(item => item.time),
  [2, 1]
 );
 assert.deepEqual(
  entries.map(item => item.time),
  [1, 2],
  'исходный порядок сохранён'
 );
});
