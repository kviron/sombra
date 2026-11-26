import type {MessageAttachmentMetadata} from '@/shared/types';
import {hasImageSize} from './attachment-preview-cache.ts';
import {isImageMime} from './message-attachment-rules.ts';

type Photo = {attachment: MessageAttachmentMetadata; ratio: number};
type AlbumRow =
 {kind: 'photos'; photos: Photo[]; ratio: number} | {kind: 'file'; attachment: MessageAttachmentMetadata};

// Choose contiguous rows with similar heights. Panoramas can fill a row by themselves.
function photoRows(photos: Photo[]): AlbumRow[] {
 const costs = Array<number>(photos.length + 1).fill(Infinity);
 const counts = Array<number>(photos.length);
 costs[photos.length] = 0;
 const maxPerRow = photos.length <= 4 ? 2 : 3;
 for (let start = photos.length - 1; start >= 0; start--) {
  let ratio = 0;
  for (let end = start; end < Math.min(start + maxPerRow, photos.length); end++) {
   ratio += photos[end].ratio;
   const cost = Math.log(ratio / 2.65) ** 2 + costs[end + 1];
   if (cost < costs[start]) {
    costs[start] = cost;
    counts[start] = end - start + 1;
   }
  }
 }
 const rows: AlbumRow[] = [];
 for (let start = 0; start < photos.length; start += counts[start]) {
  const row = photos.slice(start, start + counts[start]);
  const ratio = row.reduce((sum, photo) => sum + photo.ratio, 0);
  rows.push({kind: 'photos', photos: row, ratio: Math.max(1.25, Math.min(4, ratio))});
 }
 return rows;
}

export function attachmentAlbumRows(attachments: readonly MessageAttachmentMetadata[]) {
 const rows: AlbumRow[] = [];
 let photos: Photo[] = [];
 for (const attachment of attachments) {
  if (isImageMime(attachment.mime)) {
   const ratio = hasImageSize(attachment) ? attachment.width / attachment.height : 4 / 3;
   photos.push({attachment, ratio: Math.max(0.7, Math.min(3.2, ratio))});
  } else {
   rows.push(...photoRows(photos), {kind: 'file', attachment});
   photos = [];
  }
 }
 return rows.concat(photoRows(photos));
}
