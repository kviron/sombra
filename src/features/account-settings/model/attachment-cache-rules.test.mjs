// Правила кэша вложений: размер, подписи, лимит и доступность очистки.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
 CACHE_LIMIT_OPTIONS,
 cacheClearDisabled,
 cacheLimitNotice,
 cacheLimitValue,
 cacheSizeLabel,
 cacheSummary,
 formatCacheSize
} from './attachment-cache-rules.ts';

const info = {enabled: true, limitMiB: 512, bytes: 1536 * 1024 ** 2, files: 12};

test('размер переводится в ГиБ, МиБ и КиБ', () => {
 assert.equal(formatCacheSize(1024 ** 3), '1.00 ГиБ');
 assert.equal(formatCacheSize(512 * 1024 ** 2), '512.0 МиБ');
 assert.equal(formatCacheSize(1500), '2 КиБ');
 assert.equal(formatCacheSize(0), '0 КиБ');
});

test('подпись под хранилищем показывает файлы и состояние кэша', () => {
 assert.equal(cacheSummary(info), '12 файлов · кэш включён');
 assert.equal(cacheSummary({...info, enabled: false}), '12 файлов · кэш выключен');
 assert.equal(cacheSummary(null), 'Получаем сведения о хранилище');
});

test('до загрузки показывается лимит по умолчанию, а размер — «Загружаем…»', () => {
 assert.equal(cacheLimitValue(null), '1024');
 assert.equal(cacheLimitValue({...info, limitMiB: 0}), '0');
 assert.equal(cacheSizeLabel(null), 'Загружаем…');
 assert.equal(cacheSizeLabel(info), '1.50 ГиБ');
 assert.deepEqual(
  CACHE_LIMIT_OPTIONS.map(option => option.value),
  ['0', '256', '512', '1024', '2048', '4096']
 );
});

test('нулевой лимит сообщает о выключенном и очищенном кэше', () => {
 assert.equal(cacheLimitNotice(512), 'Лимит кэша сохранён.');
 assert.equal(cacheLimitNotice(0), 'Кэш выключен и очищен.');
});

test('очистка недоступна без готовности, во время операции и при пустом кэше', () => {
 assert.equal(cacheClearDisabled(true, false, info), false);
 assert.equal(cacheClearDisabled(false, false, info), true, 'настройки не загружены');
 assert.equal(cacheClearDisabled(true, true, info), true, 'идёт операция');
 assert.equal(cacheClearDisabled(true, false, null), true, 'сведения ещё не получены');
 assert.equal(cacheClearDisabled(true, false, {...info, files: 0}), true, 'чистить нечего');
});
