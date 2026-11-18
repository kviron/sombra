// Pure helpers from assistant-ui Elements File (MIT), adapted for Sombra.
// Upstream: packages/ui/src/components/react/assistant-ui/elements/file.tsx
// Commit 076de9eaf1b5f0f1fb6fb359c5e5d68770cae65c.
export type FileIconKind = 'image' | 'pdf' | 'json' | 'text' | 'audio' | 'video' | 'file';

/** Same mime branches as upstream getMimeTypeIcon, kept pure so the mapping is testable. */
export function fileIconKind(mimeType: string): FileIconKind {
  const type = (mimeType || '').toLowerCase();
  if (type.startsWith('image/')) return 'image';
  if (type === 'application/pdf') return 'pdf';
  if (type === 'application/json') return 'json';
  if (type.startsWith('text/')) return 'text';
  if (type.startsWith('audio/')) return 'audio';
  if (type.startsWith('video/')) return 'video';
  return 'file';
}

/** Fallback label when a message attachment has no usable filename. */
export function fileLabel(mimeType: string): string {
  const subtype = /^[^/;]+\/(?:x-)?(?:[^;+]*\.)?([^;+.\s]+)/.exec((mimeType || '').toLowerCase())?.[1];
  if (!subtype || subtype === 'octet-stream') return 'Файл';
  if (subtype === 'plain') return 'Текстовый файл';
  return `${subtype.toUpperCase()}-файл`;
}

/** Sombra size labels (binary units), matching the rest of the attachment UI. */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${Math.floor(bytes)} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КиБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МиБ`;
}
