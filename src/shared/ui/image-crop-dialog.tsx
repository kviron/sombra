import {useEffect,useRef,useState} from 'react';
import {Dialog} from 'radix-ui';
import Cropper, {type Area} from 'react-easy-crop';
import {prepareCroppedImage,readImageSource,type ImageKind,type ImageSourceInfo,type NormalizedCrop,type PreparedProfileImage} from '../lib/image-crop';
import './image-crop-dialog.css';
export type {PreparedProfileImage} from '../lib/image-crop';
export type ImageCropDialogProps={file:File;kind:ImageKind;onConfirm:(result:PreparedProfileImage)=>Promise<void>|void;onClose:()=>void};
export function ImageCropDialog({file,kind,onConfirm,onClose}:ImageCropDialogProps){
 const [image,setImage]=useState(''),[info,setInfo]=useState<ImageSourceInfo|null>(null),[position,setPosition]=useState({x:0,y:0}),[zoom,setZoom]=useState(1),[crop,setCrop]=useState<NormalizedCrop|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const epoch=useRef(0),saving=useRef(false),closed=useRef(false),activeUrl=useRef('');const zoomId=useRef(`crop-zoom-${Math.random().toString(36).slice(2)}`).current;
 useEffect(()=>{
  const current=++epoch.current;closed.current=false;saving.current=false;let url='';setImage('');setInfo(null);setError('');setBusy(false);setPosition({x:0,y:0});setZoom(1);setCrop(null);
  void (async()=>{try{
   const source=await readImageSource(file,kind);if(epoch.current!==current)return;
   let blob:Blob=file;
   if(source.info.mime!=='image/gif'){
    const bitmap=await createImageBitmap(new Blob([source.bytes as BlobPart],{type:source.info.mime}),{imageOrientation:'from-image'});
    try{if(epoch.current!==current)return;if(bitmap.width!==source.info.width||bitmap.height!==source.info.height)throw new Error('Размер изображения не совпадает с заголовком');const scale=Math.min(1,2048/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));if(Math.abs((canvas.width/canvas.height)/(bitmap.width/bitmap.height)-1)>0.005){canvas.width=bitmap.width;canvas.height=bitmap.height;}const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Не удалось открыть изображение');ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);const preview=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/png'));if(!preview)throw new Error('Не удалось открыть изображение');blob=preview;}finally{bitmap.close();}
   }
   if(epoch.current!==current)return;url=URL.createObjectURL(blob);activeUrl.current=url;setInfo(source.info);setImage(url);
  }catch(reason){if(epoch.current===current)setError(reason instanceof Error?reason.message:'Не удалось открыть изображение');}})();
  return()=>{epoch.current++;closed.current=true;if(url)URL.revokeObjectURL(url);};
 },[file,kind]);
 function close(){closed.current=true;epoch.current++;if(activeUrl.current){URL.revokeObjectURL(activeUrl.current);activeUrl.current='';}onClose();}
 async function apply(){if(!crop||saving.current||closed.current)return;saving.current=true;setBusy(true);setError('');const current=epoch.current;try{const result=await prepareCroppedImage(file,kind,crop);if(epoch.current!==current||closed.current)return;await onConfirm(result);}catch(reason){if(epoch.current===current&&!closed.current)setError(reason instanceof Error?reason.message:'Не удалось сохранить изображение');}finally{if(epoch.current===current&&!closed.current){saving.current=false;setBusy(false);}}}
 function completed(area:Area){setCrop({x:area.x,y:area.y,width:area.width,height:area.height});}
 return <Dialog.Root open onOpenChange={open=>{if(!open)close();}}><Dialog.Portal><Dialog.Overlay className="image-crop-overlay"/><Dialog.Content className="image-crop-dialog" data-image-crop-dialog aria-busy={busy} onEscapeKeyDown={event=>event.stopPropagation()}>
  <header><Dialog.Title>{kind==='avatar'?'Настроить аватар':'Настроить обложку'}</Dialog.Title><Dialog.Description>Перетащите изображение и настройте масштаб. Стрелки перемещают кадр.</Dialog.Description></header>
  <div className={`image-crop-stage image-crop-stage--${kind}`}>
   {image?<Cropper image={image} crop={position} zoom={zoom} aspect={kind==='avatar'?1:3} cropShape={kind==='avatar'?'round':'rect'} showGrid={kind==='cover'} onCropChange={setPosition} onZoomChange={setZoom} onCropComplete={completed} minZoom={1} maxZoom={4} keyboardStep={10} cropperProps={{'aria-label':'Кадрирование изображения: перемещение стрелками','aria-disabled':busy}} zoomWithScroll={!busy} onMediaLoaded={()=>setError('')} style={{containerStyle:{pointerEvents:busy?'none':undefined}}} mediaProps={{onError:()=>{setError('Не удалось декодировать изображение');setImage('');setCrop(null);},alt:kind==='avatar'?'Предпросмотр аватара':'Предпросмотр обложки'}}/>:!error&&<p role="status">Загрузка изображения…</p>}
  </div>
  {info?.mime==='image/gif'&&<p className="image-crop-note">Анимация сохранится. Кадрирование применяется при показе, исходный GIF не изменяется.</p>}
  <div className="image-crop-controls"><label htmlFor={zoomId}>Масштаб</label><input id={zoomId} type="range" min="1" max="4" step="0.01" value={zoom} onChange={event=>setZoom(Number(event.target.value))} disabled={!image||busy}/><output htmlFor={zoomId}>{Math.round(zoom*100)}%</output><button type="button" disabled={!image||busy} onClick={()=>{setPosition({x:0,y:0});setZoom(1);}}>Сбросить</button></div>
  {error&&<p className="image-crop-error" role="alert">{error}</p>}
  <footer><button type="button" onClick={close}>Отмена</button><button type="button" className="image-crop-apply" disabled={!image||!crop||busy} onClick={()=>void apply()}>{busy?'Сохранение…':'Применить'}</button></footer>
 </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
