// Тексты экрана сбоя: заголовок, краткая строка и полный отчёт для буфера обмена.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {errorDetails, errorSummary, errorTitle} from './error-summary.ts';

test('summary keeps the error name and message', () => {
  assert.equal(errorSummary(new TypeError('value is undefined')), 'TypeError: value is undefined');
});

test('summary falls back to the name for an empty message', () => {
  assert.equal(errorSummary(new Error('')), 'Error');
});

test('the title is human and never repeats the message', () => {
  const error = new Error('Cannot read properties of undefined (reading "x")');
  const title = errorTitle(error);
  assert.ok(title.length > 0);
  assert.ok(!title.includes('Cannot read'), title);
});

test('details carry the stack, the component tree and the time', () => {
  const error = new Error('boom');
  error.stack = 'Error: boom\n    at render (app.tsx:1:1)';
  const text = errorDetails(error, '\n    at App\n    at Root');
  assert.match(text, /Error: boom/);
  assert.match(text, /at render \(app\.tsx:1:1\)/);
  assert.match(text, /Дерево компонентов:/);
  assert.match(text, /at App/);
  assert.match(text, /Время: \d{4}-\d{2}-\d{2}T/);
});

test('details work without a stack and without a component tree', () => {
  const error = new Error('plain');
  const text = errorDetails(error);
  assert.match(text, /Error: plain/);
  assert.doesNotMatch(text, /Дерево компонентов:/);
});
