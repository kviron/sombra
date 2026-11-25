import type {ReactNode} from 'react';
import {FileUp, Files} from 'lucide-react';
import {cn} from '@/shared/lib/utils';
import {useAttachmentDropZone} from '../model/use-attachment-drop-zone';

/** Используются только выданные браузером File: произвольные пути файловой системы не открываются. */
export function AttachmentDropZone({
 channel,
 disabled = false,
 className,
 onFile,
 children
}: {
 channel?: string;
 disabled?: boolean;
 className?: string;
 onFile: (file: File) => void;
 children: ReactNode;
}) {
 const model = useAttachmentDropZone({channel, disabled, onFile});
 const {handlers} = model;

 return (
  <section
   className={cn('conversation bg-card relative isolate', className)}
   onDragEnter={handlers.enter}
   onDragOver={handlers.over}
   onDragLeave={handlers.leave}
   onDrop={handlers.drop}
   data-file-drag={model.overlay || undefined}
  >
   {children}
   {model.overlay && (
    <div
     className="border-border bg-card pointer-events-none absolute inset-0 z-[45] grid place-items-center rounded-[10px] border-2 border-dashed p-6 backdrop-blur-[7px] max-[760px]:p-4"
     role="status"
     aria-live="polite"
    >
     <div className="text-foreground max-w-[480px] text-center">
      <span className="text-primary relative mb-6 inline-grid">
       <Files size={44} />
       <FileUp
        className="border-border bg-card absolute -right-3 -bottom-2 box-content rounded-[8px] border p-1"
        size={28}
       />
      </span>
      <strong className="block text-[22px] leading-[1.35] font-semibold max-[760px]:text-[18px]">
       Перетащите файл сюда
      </strong>
      <p className="text-foreground my-3 text-[15px] leading-[1.6] max-[760px]:text-[14px]">
       Изображение, документ или любой другой файл до 10 МиБ
      </p>
      <small className="text-muted-foreground block text-[13px] leading-[1.6]">
       Файл добавится во вложения. Отправка — только по кнопке.
      </small>
     </div>
    </div>
   )}
  </section>
 );
}
