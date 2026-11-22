// Правила уведомлений: значения по умолчанию, готовность переключателя, запрос и ошибки.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
 notificationDisabled,
 notificationError,
 notificationPayload,
 notificationsEnabled
} from './notification-settings-rules.ts';

const preferences = {revision: 1, notifications: {direct: false, groups: true}, dialogs: {}};

test('без настроек уведомления включены, а выключенная категория остаётся выключенной', () => {
 assert.equal(notificationsEnabled(undefined, 'direct'), true, 'сервер ещё не прислал настройки');
 assert.equal(notificationsEnabled(preferences, 'direct'), false);
 assert.equal(notificationsEnabled(preferences, 'groups'), true);
 assert.equal(notificationsEnabled({...preferences, notifications: {direct: true, groups: false}}, 'groups'), false);
});

test('переключатель недоступен без готовности или во время сохранения', () => {
 assert.equal(notificationDisabled(false, false), true, 'настройки не загружены');
 assert.equal(notificationDisabled(true, true), true, 'идёт сохранение');
 assert.equal(notificationDisabled(true, false), false);
});

test('запрос меняет только выбранную категорию', () => {
 assert.deepEqual(notificationPayload('direct', false), {direct: false});
 assert.deepEqual(notificationPayload('groups', true), {groups: true});
 assert.equal('notifications' in notificationPayload('groups', true), false, 'остальные поля не перезаписываются');
});

test('ошибка берётся из сообщения сервера, иначе показывается общая подпись', () => {
 assert.equal(notificationError(new Error('Сервер недоступен')), 'Сервер недоступен');
 assert.equal(notificationError('строки не считаются ошибкой'), 'Не удалось сохранить настройки уведомлений.');
});
