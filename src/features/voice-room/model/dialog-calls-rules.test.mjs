// Правила звонков: срок жизни звонка, выбор входящего, занятость и текст ошибки.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {callError, callsBusy, incomingCall, incomingCallsBusy, liveCall} from './dialog-calls-rules.ts';

const now = 1_700_000_000_000;
const call = (extra = {}) => ({
 id: 'call-1',
 dialog: 'd1',
 caller: 'anna',
 video: true,
 created_at: 1,
 participants: [],
 declined: [],
 ...extra
});

test('пустой звонок живёт минуту после опустения', () => {
 assert.equal(liveCall(call(), now), true, 'звонок не пуст');
 assert.equal(liveCall(call({empty_since: now / 1000 - 59}), now), true);
 assert.equal(liveCall(call({empty_since: now / 1000 - 61}), now), false);
});

test('входящий — живой звонок не от себя и не в текущей комнате', () => {
 const args = {account: 'me', room: '', handled: new Set()};
 assert.equal(incomingCall({...args, calls: [call()], now})?.id, 'call-1');
 assert.equal(incomingCall({...args, calls: [call({caller: 'me'})], now}), undefined, 'свой звонок не входящий');
 assert.equal(incomingCall({...args, calls: [call({participants: ['me']})], now}), undefined, 'уже участвует');
 assert.equal(incomingCall({...args, calls: [call({declined: ['me']})], now}), undefined, 'уже отклонил');
 assert.equal(incomingCall({...args, room: 'call-1', calls: [call()], now}), undefined, 'уже в этой комнате');
 assert.equal(incomingCall({...args, calls: [call()], handled: new Set(['call-1']), now}), undefined, 'уже обработан');
 assert.equal(incomingCall({...args, calls: [call({empty_since: now / 1000 - 61})], now}), undefined, 'звонок истёк');
});

test('занятость складывается из операции ответа и отклонения', () => {
 const operation = {id: 'call-1'};
 const declining = {id: 'call-1'};
 assert.equal(callsBusy(null, null), false);
 assert.equal(callsBusy(operation, null), true);
 assert.equal(callsBusy(null, declining), true);
});

test('кнопки входящего блокируются только его собственной операцией', () => {
 assert.equal(incomingCallsBusy({operation: null, declining: null, id: 'call-1'}), false);
 assert.equal(incomingCallsBusy({operation: {id: 'call-1'}, declining: null, id: 'call-1'}), true);
 assert.equal(incomingCallsBusy({operation: {id: 'call-2'}, declining: null, id: 'call-1'}), false);
 assert.equal(incomingCallsBusy({operation: null, declining: {id: 'call-1'}, id: 'call-1'}), true);
 assert.equal(incomingCallsBusy({operation: null, declining: null, id: undefined}), false);
});

test('ошибка берётся из сообщения, иначе показывается подпись места', () => {
 assert.equal(callError(new Error('Микрофон занят'), 'Не удалось ответить.'), 'Микрофон занят');
 assert.equal(callError(new Error(''), 'Не удалось ответить.'), 'Не удалось ответить.');
 assert.equal(callError('timeout', 'Не удалось ответить.'), 'Не удалось ответить.');
});
