import {useRef} from 'react';
import {Paperclip} from 'lucide-react';
import {ComposerIconButton} from '@/shared/ui/elements-composer';
import {TooltipLabel} from '@/shared/ui/tooltip';

export function AttachmentComposer({disabled, onFiles}: {disabled?: boolean; onFiles: (files: File[]) => void}) {
 const input = useRef<HTMLInputElement>(null);
 const label = 'Прикрепить файлы (до 10 файлов по 10 МиБ)';
 return (
  <div className="attachment-composer">
   <input
    ref={input}
    type="file"
    multiple
    hidden
    disabled={disabled}
    onChange={event => {
     const files = Array.from(event.currentTarget.files || []);
     event.currentTarget.value = '';
     if (files.length) onFiles(files);
    }}
   />
   <TooltipLabel content={label}>
    <ComposerIconButton disabled={disabled} aria-label={label} onClick={() => input.current?.click()}>
     <Paperclip size={16} />
    </ComposerIconButton>
   </TooltipLabel>
  </div>
 );
}
