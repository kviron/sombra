// Чистые правила кэша вложений: лимиты, размер и подписи без сети и DOM.
import type {CacheInfo} from '@/shared/api';

export type CacheLimitOption = {value: string; label: string};

export const CACHE_LIMIT_OPTIONS: CacheLimitOption[] = [
 {value: '0', label: 'Не сохранять кэш'},
 {value: '256', label: '256 МиБ'},
 {value: '512', label: '512 МиБ'},
 {value: '1024', label: '1 ГиБ'},
 {value: '2048', label: '2 ГиБ'},
 {value: '4096', label: '4 ГиБ'}
];

export const DEFAULT_CACHE_LIMIT_MIB = 1024;

/** Размер для человека: ГиБ и МиБ с десятыми, остальное — в КиБ. */
export function formatCacheSize(bytes: number): string {
 return bytes >= 1024 ** 3
  ? `${(bytes / 1024 ** 3).toFixed(2)} ГиБ`
  : bytes >= 1024 ** 2
    ? `${(bytes / 1024 ** 2).toFixed(1)} МиБ`
    : `${Math.ceil(bytes / 1024)} КиБ`;
}

/** Пока данных нет, честно написано, что их получаем. */
export function cacheSummary(info: CacheInfo | null): string {
 return info
  ? `${info.files} файлов · ${info.enabled ? 'кэш включён' : 'кэш выключен'}`
  : 'Получаем сведения о хранилище';
}

export function cacheSizeLabel(info: CacheInfo | null): string {
 return info ? formatCacheSize(info.bytes) : 'Загружаем…';
}

/** В списке выбрано текущее ограничение; до загрузки — лимит по умолчанию. */
export function cacheLimitValue(info: CacheInfo | null): string {
 return String(info?.limitMiB ?? DEFAULT_CACHE_LIMIT_MIB);
}

/** Нулевой лимит означает не только ограничение, но и очистку кэша. */
export function cacheLimitNotice(limitMiB: number): string {
 return limitMiB ? 'Лимит кэша сохранён.' : 'Кэш выключен и очищен.';
}

/** Очистка доступна, только когда известно, что чистить. */
export function cacheClearDisabled(ready: boolean, busy: boolean, info: CacheInfo | null): boolean {
 return busy || !ready || !info || !info.files;
}
