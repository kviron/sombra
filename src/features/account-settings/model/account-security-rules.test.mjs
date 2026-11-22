// Правила безопасности аккаунта: форма профиля, пароль, обложка, подписи сеансов и уведомления.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
 coverProblem,
 deviceLabel,
 emailUnchanged,
 identityUnchanged,
 lastSeenLabel,
 mediaNotice,
 nameProblem,
 passwordProblem,
 sessionTitle
} from './account-security-rules.ts';

const session = (extra = {}) => ({
 id: 's1',
 device: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Sombra/0.1',
 created_at: 0,
 last_seen: 0,
 expires_at: 0,
 current: false,
 ...extra
});

test('имя профиля ограничено 2–32 символами после обрезки', () => {
 assert.equal(nameProblem('  '), 'Имя: 2–32 символа');
 assert.equal(nameProblem(' Я '), 'Имя: 2–32 символа');
 assert.equal(nameProblem('Аня'), '');
 assert.equal(nameProblem('я'.repeat(33)), 'Имя: 2–32 символа');
 assert.equal(nameProblem('я'.repeat(32)), '');
});

test('неизменённый профиль не сохраняется', () => {
 const me = {name: 'Аня', bio: 'Люблю музыку'};
 assert.equal(identityUnchanged(' Аня ', 'Люблю музыку', me), true);
 assert.equal(identityUnchanged('Аня', 'Другое', me), false);
 assert.equal(identityUnchanged('Аня', 'Люблю музыку', undefined), false);
});

test('пароль должен совпадать с подтверждением', () => {
 assert.equal(passwordProblem('secret123', 'secret123'), '');
 assert.equal(passwordProblem('secret123', 'secret124'), 'Пароли не совпадают');
 assert.equal(passwordProblem(null, undefined), 'Пароли не совпадают');
});

test('обложка требует поддержки сервера', () => {
 assert.equal(coverProblem(false), 'Для обложек требуется обновление сервера');
 assert.equal(coverProblem(true), '');
});

test('подпись сеанса: текущее устройство, Windows, Mac или браузер', () => {
 assert.equal(sessionTitle(session({current: true})), 'Это устройство');
 assert.equal(sessionTitle(session()), 'Windows');
 assert.equal(sessionTitle(session({device: 'Mozilla/5.0 (Macintosh)'})), 'Mac');
 assert.equal(sessionTitle(session({device: 'Sombra Android'})), 'Браузер / приложение');
 assert.equal(deviceLabel('я'.repeat(80)), 'я'.repeat(70));
});

test('дата последней активности показывается по-русски', () => {
 assert.equal(typeof lastSeenLabel(0), 'string');
 assert.match(lastSeenLabel(Date.UTC(2026, 0, 2, 3, 4) / 1000), /2026/);
});

test('уведомление зависит от вида картинки и удаления', () => {
 assert.equal(mediaNotice('avatar', false), 'Аватарка сохранена');
 assert.equal(mediaNotice('avatar', true), 'Аватарка удалена');
 assert.equal(mediaNotice('cover', false), 'Обложка сохранена');
 assert.equal(mediaNotice('cover', true), 'Обложка удалена');
});

test('неизменённая почта не требует сохранения', () => {
 assert.equal(emailUnchanged(' Me@Example.com ', 'me@example.com'), true);
 assert.equal(emailUnchanged('other@example.com', 'me@example.com'), false);
 assert.equal(emailUnchanged('', undefined), false, 'без данных аккаунта сохранение не блокируется');
});
