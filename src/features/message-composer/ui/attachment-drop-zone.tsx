import type {ReactNode} from 'react';
import {FileUp, Files} from 'lucide-react';
import {useAttachmentDropZone} from '../model/use-attachment-drop-zone';

/** Используются только выданные браузером File: произвольные пути файловой системы не открываются. */
export function AttachmentDropZone({
 channel,
 disabled = false,
 onFile,
 children
}: {
 channel?: string;
 disabled?: boolean;
 onFile: (file: File) => void;
 children: ReactNode;
}) {
 const model = useAttachmentDropZone({channel, disabled, onFile});
 const {handlers} = model;

 return (
  <section
   className="conversation relative isolate bg-[#05070c61]"
   onDragEnter={handlers.enter}
   onDragOver={handlers.over}
   onDragLeave={handlers.leave}
   onDrop={handlers.drop}
   data-file-drag={model.overlay || undefined}
  >
   {children}
   {model.overlay && (
    <div
     className="pointer-events-none absolute inset-0 z-[45] grid place-items-center rounded-[10px] border-2 border-dashed border-[#bca0e599] bg-[#141720d9] p-6 backdrop-blur-[7px] max-[760px]:p-4"
     role="status"
     aria-live="polite"
    >
     <div className="max-w-[480px] text-center text-[#eef0f7]">
      <span className="relative mb-6 inline-grid text-[#d4bafa]">
       <Files size={44} />
       <FileUp
        className="absolute -right-3 -bottom-2 box-content rounded-[8px] border border-[#bca0e566] bg-[#302542] p-1"
        size={28}
       />
      </span>
      <strong className="block text-[22px] leading-[1.35] font-semibold max-[760px]:text-[18px]">
       Перетащите файл сюда
      </strong>
      <p className="my-3 text-[15px] leading-[1.6] text-[#d4d7e3] max-[760px]:text-[14px]">
       Изображение, документ или любой другой файл до 10 МиБ
      </p>
      <small className="block text-[13px] leading-[1.6] text-[#c0c4d3]">
       Файл добавится во вложения. Отправка — только по кнопке.
      </small>
     </div>
    </div>
   )}
  </section>
 );
}
