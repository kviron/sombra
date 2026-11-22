import {clearAttachmentCache, getAttachmentCacheInfo, setAttachmentCacheLimit, type CacheInfo} from '../transport';

/** Кэш вложений живёт в Tauri, а не в API: экран настроек обращается к нему через сервис. */
export const attachmentCacheService = {
 info: (): Promise<CacheInfo> => getAttachmentCacheInfo(),
 setLimit: (limitMiB: number): Promise<CacheInfo> => setAttachmentCacheLimit(limitMiB),
 clear: (): Promise<CacheInfo> => clearAttachmentCache()
};

export type {CacheInfo};
