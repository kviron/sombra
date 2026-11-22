// A snapshot must not render one entity twice: duplicate ids are dropped at the API boundary.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {uniqueIds, uniqueRows} from './unique-rows.ts';

test('keeps the first row for a repeated id', () => {
  const rows = [
    {id: 'a', name: 'первый'},
    {id: 'b', name: 'второй'},
    {id: 'a', name: 'повтор'},
  ];
  assert.deepEqual(uniqueRows(rows, 'сообщениях', false), [
    {id: 'a', name: 'первый'},
    {id: 'b', name: 'второй'},
  ]);
});

test('reports the collection and the id once per duplicate', () => {
  const warnings = [];
  const original = console.warn;
  console.warn = (message) => warnings.push(message);
  try {
    uniqueRows([{id: 'x'}, {id: 'x'}, {id: 'x'}], 'переписках');
  } finally {
    console.warn = original;
  }
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /переписках/);
  assert.match(warnings[0], /x/);
});

test('keeps rows without a string id untouched and tolerates missing arrays', () => {
  const rows = [{id: 'a'}, {name: 'без id'}, {id: undefined}];
  assert.equal(uniqueRows(rows, 'проверка', false).length, 3);
  assert.deepEqual(uniqueRows(undefined, 'проверка', false), []);
});

test('member lists are deduplicated in place', () => {
  assert.deepEqual(uniqueIds(['a', 'b', 'a']), ['a', 'b']);
  assert.deepEqual(uniqueIds(undefined), []);
});
