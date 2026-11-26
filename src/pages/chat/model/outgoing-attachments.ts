import type {ChatMessage} from '@/shared/types';

/** После сбоя операции остаются id уже загруженных файлов, в изначальном порядке. */
export async function stageAttachments(
 files: readonly File[],
 uploadedIds: readonly string[],
 upload: (file: File) => Promise<string>,
 remember: (ids: string[]) => void
) {
 let ids = [...uploadedIds];
 for (const file of files.slice(ids.length)) {
  const id = await upload(file);
  if (!id) throw new Error('Сервер не подтвердил загрузку вложения.');
  ids = [...ids, id];
  remember(ids);
 }
 return ids;
}

export function matchesAlbum(ids: readonly string[], count: number, message: Pick<ChatMessage, 'attachments'>) {
 return (
  ids.length === count &&
  message.attachments?.length === count &&
  ids.every((id, index) => message.attachments?.[index].id === id)
 );
}
