import type {ReactNode} from 'react';
import {FileUp, Files} from 'lucide-react';
import {useAttachmentDropZone} from '../model/use-attachment-drop-zone';
import './attachment-drop-zone.css';

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
   className="conversation attachment-drop-zone"
   onDragEnter={handlers.enter}
   onDragOver={handlers.over}
   onDragLeave={handlers.leave}
   onDrop={handlers.drop}
   data-file-drag={model.overlay || undefined}
  >
   {children}
   {model.overlay && (
    <div className="attachment-drop-overlay" role="status" aria-live="polite">
     <div className="attachment-drop-hint">
      <span className="attachment-drop-icon">
       <Files size={44} />
       <FileUp size={28} />
      </span>
      <strong>Перетащите файл сюда</strong>
      <p>Изображение, документ или любой другой файл до 10 МиБ</p>
      <small>Файл добавится во вложения. Отправка — только по кнопке.</small>
     </div>
    </div>
   )}
  </section>
 );
}
