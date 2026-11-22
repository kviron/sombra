export type AttachmentDownloadFailure = {message: string; authRequired: boolean};

/** Map a failed attachment read/save to the single message the chat UI can show. */
export function attachmentDownloadFailure(reason: unknown, fallback: string): AttachmentDownloadFailure {
 const raw = reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : '';
 if (raw.includes('AUTH_REQUIRED')) {
  return {message: 'Сессия завершена. Войдите снова.', authRequired: true};
 }
 const message = raw.replace(/^REMOTE_UNAVAILABLE:/, '').trim();
 return {message: message || fallback, authRequired: false};
}
