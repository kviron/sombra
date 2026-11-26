import {useEffect, useState} from 'react';
import {XIcon} from 'lucide-react';
import {
 Attachment,
 AttachmentAction,
 AttachmentActions,
 AttachmentContent,
 AttachmentDescription,
 AttachmentGroup,
 AttachmentMedia,
 AttachmentTitle
} from '@/shared/ui/attachment';
import {FileIconDisplay, fileLabel, formatFileSize} from '@/shared/ui/elements-media';
import {draftImageMime, type DraftAttachment} from '../model/draft-attachments';

function DraftCard({file, disabled, onRemove}: {file: File; disabled?: boolean; onRemove: () => void}) {
 const [preview, setPreview] = useState<string>();
 useEffect(() => {
  let current = true;
  let url: string | undefined;
  void file
   .slice(0, 12)
   .arrayBuffer()
   .then(header => {
    const mime = draftImageMime(new Uint8Array(header));
    if (current && mime) {
     url = URL.createObjectURL(file.slice(0, file.size, mime));
     setPreview(url);
    }
   })
   .catch(() => {});
  return () => {
   current = false;
   if (url) URL.revokeObjectURL(url);
  };
 }, [file]);
 const name = file.name || 'Вложение';
 const type = name.match(/\.([a-z0-9]{1,12})$/i)?.[1].toUpperCase() || fileLabel(file.type);
 return (
  <Attachment orientation="vertical" className="rounded-2xl">
   <AttachmentMedia variant={preview ? 'image' : 'icon'}>
    {preview ? (
     <img
      src={preview}
      alt=""
      className="size-full object-cover"
      loading="lazy"
      decoding="async"
      onError={() => setPreview(undefined)}
     />
    ) : (
     <FileIconDisplay mimeType={file.type} />
    )}
   </AttachmentMedia>
   <AttachmentContent>
    <AttachmentTitle title={name}>{name}</AttachmentTitle>
    <AttachmentDescription>
     {type} · {formatFileSize(file.size)}
    </AttachmentDescription>
   </AttachmentContent>
   <AttachmentActions>
    <AttachmentAction
     type="button"
     variant="secondary"
     disabled={disabled}
     className="size-6 rounded-full"
     aria-label={`Убрать ${name}`}
     onClick={onRemove}
    >
     <XIcon />
    </AttachmentAction>
   </AttachmentActions>
  </Attachment>
 );
}

export function AttachmentDraftPreview({
 attachments,
 disabled,
 onRemove
}: {
 attachments: readonly DraftAttachment[];
 disabled?: boolean;
 onRemove: (id: string) => void;
}) {
 if (!attachments.length) return null;
 return (
  <AttachmentGroup role="group" aria-label="Вложения перед отправкой" className="items-start pt-2">
   {attachments.map(({id, file}) => (
    <DraftCard key={id} file={file} disabled={disabled} onRemove={() => onRemove(id)} />
   ))}
  </AttachmentGroup>
 );
}
