import {useEffect,useRef,useState,type DragEvent,type ReactNode} from 'react';
import {FileUp,Files} from 'lucide-react';
import {toast} from 'sonner';
import './attachment-drop-zone.css';

/** File drags have no readable files until drop, but advertise the Files type. */
export function hasDraggedFiles(transfer:DataTransfer|null):boolean{
 return !!transfer&&(Array.from(transfer.types||[]).includes('Files')||Array.from(transfer.items||[]).some(item=>item.kind==='file')||transfer.files?.length>0);
}

/** Uses browser-granted File objects only; never opens arbitrary filesystem paths. */
export function AttachmentDropZone({channel,disabled=false,onFile,children}:{channel?:string;disabled?:boolean;onFile:(file:File)=>void;children:ReactNode}){
 const [dragging,setDragging]=useState(false);
 const depth=useRef(0);
 const accepting=!!channel&&!disabled;
 function reset(){depth.current=0;setDragging(false);}
 useEffect(()=>{reset()},[channel,disabled]);
 useEffect(()=>{
  // Prevent WebView/browser navigation for file drops outside the conversation too.
  // Text selection, link drags and paste keep their normal behavior.
  const outsideDrag=(event:globalThis.DragEvent)=>{
   if(!hasDraggedFiles(event.dataTransfer))return;
   event.preventDefault();
   if(event.dataTransfer)event.dataTransfer.dropEffect='none';
  };
  const outsideDrop=(event:globalThis.DragEvent)=>{if(hasDraggedFiles(event.dataTransfer)){event.preventDefault();reset()}};
  const leave=(event:globalThis.DragEvent)=>{if(event.relatedTarget===null)reset()};
  const stop=()=>reset();
  window.addEventListener('dragover',outsideDrag);
  window.addEventListener('drop',outsideDrop);
  window.addEventListener('dragleave',leave);
  window.addEventListener('dragend',stop);
  window.addEventListener('blur',stop);
  return()=>{
   window.removeEventListener('dragover',outsideDrag);window.removeEventListener('drop',outsideDrop);
   window.removeEventListener('dragleave',leave);window.removeEventListener('dragend',stop);window.removeEventListener('blur',stop);
  };
 },[]);
 function enter(event:DragEvent<HTMLElement>){
  if(!hasDraggedFiles(event.dataTransfer))return;
  event.preventDefault();event.stopPropagation();
  if(!accepting)return;
  depth.current++;setDragging(true);
 }
 function over(event:DragEvent<HTMLElement>){
  if(!hasDraggedFiles(event.dataTransfer))return;
  event.preventDefault();event.stopPropagation();
  event.dataTransfer.dropEffect=accepting?'copy':'none';
  if(accepting)setDragging(true);
 }
 function leave(event:DragEvent<HTMLElement>){
  if(!hasDraggedFiles(event.dataTransfer))return;
  event.preventDefault();event.stopPropagation();
  // Moving between nested messages/buttons must not flicker the overlay.
  depth.current=Math.max(0,depth.current-1);
  if(event.relatedTarget instanceof Node&&event.currentTarget.contains(event.relatedTarget))return;
  if(!depth.current||(event.relatedTarget instanceof Node&&!event.currentTarget.contains(event.relatedTarget)))reset();
 }
 function drop(event:DragEvent<HTMLElement>){
  if(!hasDraggedFiles(event.dataTransfer))return;
  event.preventDefault();event.stopPropagation();reset();
  if(!accepting)return;
  const items=Array.from(event.dataTransfer.items||[]).filter(item=>item.kind==='file');
  if(items.some(item=>item.webkitGetAsEntry?.()?.isDirectory)){toast.error('Перетащите файл, а не папку.');return}
  const files=Array.from(event.dataTransfer.files||[]);
  if(files.length!==1){toast.error(files.length>1?'Пока можно прикрепить один файл за раз.':'Не удалось получить файл. Попробуйте кнопку вложения.');return}
  onFile(files[0]);
 }
 return <section className="conversation attachment-drop-zone" onDragEnter={enter} onDragOver={over} onDragLeave={leave} onDrop={drop} data-file-drag={dragging&&accepting||undefined}>
  {children}
  {dragging&&accepting&&<div className="attachment-drop-overlay" role="status" aria-live="polite"><div className="attachment-drop-hint"><span className="attachment-drop-icon"><Files size={44}/><FileUp size={28}/></span><strong>Перетащите файл сюда</strong><p>Изображение, документ или любой другой файл до 10 МиБ</p><small>Файл добавится во вложения. Отправка — только по кнопке.</small></div></div>}
 </section>;
}
