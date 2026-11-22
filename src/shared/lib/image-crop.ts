export type ImageKind = 'avatar' | 'cover';
export type NormalizedCrop = { x:number; y:number; width:number; height:number };
export type PreparedProfileImage = { dataUrl:string; width:number; height:number; mime:string; crop:NormalizedCrop };
export type ImageSourceInfo = { width:number; height:number; mime:string; frames:number };
const MiB=1024*1024;
const invalid=()=>new Error('Повреждённое или неподдерживаемое изображение');
export function validateCrop(crop:NormalizedCrop,width:number,height:number,aspect:number){
 const {x,y,width:w,height:h}=crop;
 if(![x,y,w,h,width,height,aspect].every(Number.isFinite)||width<=0||height<=0||aspect<=0||x<0||y<0||w<=0||h<=0||x+w>100.000001||y+h>100.000001||Math.abs((w*width)/(h*height)/aspect-1)>0.015)throw invalid();
 return {x:Math.max(0,x),y:Math.max(0,y),width:Math.min(w,100-x),height:Math.min(h,100-y)};
}
/** Reads only IFD0; all offsets stay within the APP1 payload, with a fixed tag budget. */
function readExifOrientation(view:DataView,start:number,end:number){
 const fits=(p:number,n:number)=>p>=start&&p+n<=end;
 if(!fits(start,8))throw invalid();const order=view.getUint16(start);if(order!==0x4949&&order!==0x4d4d)throw invalid();const little=order===0x4949;
 if(view.getUint16(start+2,little)!==42)throw invalid();const directory=start+view.getUint32(start+4,little);if(!fits(directory,2))throw invalid();const count=view.getUint16(directory,little);if(count>256||!fits(directory+2,count*12+4))throw invalid();
 for(let i=0;i<count;i++){const tag=directory+2+i*12;if(view.getUint16(tag,little)!==0x112)continue;if(view.getUint16(tag+2,little)!==3||view.getUint32(tag+4,little)!==1)throw invalid();const orientation=view.getUint16(tag+8,little);if(orientation<1||orientation>8)throw invalid();return orientation;}
 return 1;
}
/** Bounded, pure header parser. Always run before handing bytes to a browser decoder. */
export function inspectImage(bytes:Uint8Array,mime:string,kind:ImageKind):ImageSourceInfo {
 const n=bytes.length; if(!n||n>20*MiB)throw new Error('Изображение должно быть не больше 20 МБ');
 const v=new DataView(bytes.buffer,bytes.byteOffset,n); const has=(p:number,l:number)=>p>=0&&p+l<=n;
 const text=(p:number,l:number)=>String.fromCharCode(...bytes.subarray(p,p+l));
 let width=0,height=0,frames=1,orientation=1;
 if(mime==='image/png'){
  if(!has(0,33)||text(0,8)!=='\x89PNG\r\n\x1a\n'||v.getUint32(8)!==13||text(12,4)!=='IHDR')throw invalid();
  width=v.getUint32(16);height=v.getUint32(20);
  let p=8,ended=false;while(p<n){if(!has(p,12))throw invalid();const size=v.getUint32(p);if(!has(p+8,size+4))throw invalid();const type=text(p+4,4);if(type==='IHDR'&&p!==8)throw invalid();if(type==='acTL')throw new Error('Анимированный PNG не поддерживается. Выберите статическое изображение');p+=size+12;if(type==='IEND'){if(size!==0||p!==n)throw invalid();ended=true;break;}}if(!ended)throw invalid();
 }else if(mime==='image/jpeg'){
  if(!has(0,4)||v.getUint16(0)!==0xffd8)throw invalid();let p=2,found=false;
  while(p<n){if(bytes[p++]!==255)throw invalid();while(p<n&&bytes[p]===255)p++;if(p>=n)throw invalid();const marker=bytes[p++];if(marker===0xda||marker===0xd9)break;if(marker===0x01||(marker>=0xd0&&marker<=0xd7))continue;if(!has(p,2))throw invalid();const size=v.getUint16(p);if(size<2||!has(p,size))throw invalid();if(marker===0xe1&&size>=8&&text(p+2,6)==='Exif\0\0')orientation=readExifOrientation(v,p+8,p+size);if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)){if(found||size<8)throw invalid();height=v.getUint16(p+3);width=v.getUint16(p+5);found=true;}p+=size;}if(!found||!has(n-2,2)||v.getUint16(n-2)!==0xffd9)throw invalid();
 }else if(mime==='image/webp'){
  if(!has(0,20)||text(0,4)!=='RIFF'||text(8,4)!=='WEBP'||v.getUint32(4,true)+8!==n)throw invalid();
  let p=12,extended=false,image=false;
  while(p<n){
   if(!has(p,8))throw invalid();const type=text(p,4),size=v.getUint32(p+4,true),d=p+8;if(!has(d,size))throw invalid();
   if(type==='ANIM'||type==='ANMF')throw new Error('Анимированный WebP не поддерживается');
   if(type==='VP8X'){
    if(extended||image||p!==12||size!==10||(bytes[d]&2))throw invalid();extended=true;
    width=1+bytes[d+4]+bytes[d+5]*256+bytes[d+6]*65536;height=1+bytes[d+7]+bytes[d+8]*256+bytes[d+9]*65536;
   }else if(type==='VP8 '||type==='VP8L'){
    if(image)throw invalid();image=true;let imageWidth:number,imageHeight:number;
    if(type==='VP8 '){if(size<10||(bytes[d]&1)||text(d+3,3)!=='\x9d\x01\x2a')throw invalid();imageWidth=v.getUint16(d+6,true)&16383;imageHeight=v.getUint16(d+8,true)&16383;}
    else{if(size<5||bytes[d]!==47)throw invalid();const bits=v.getUint32(d+1,true);if(bits>>>29)throw invalid();imageWidth=(bits&16383)+1;imageHeight=((bits>>>14)&16383)+1;}
    if(extended&&(width!==imageWidth||height!==imageHeight))throw invalid();width=imageWidth;height=imageHeight;
   }
   p=d+size+(size%2);
  }
  if(p!==n||!image)throw invalid();
 }else if(mime==='image/gif'){
  if(kind!=='cover')throw new Error('Для аватара выберите статическое изображение PNG, JPEG или WebP. GIF не поддерживается');
  if(n>2*MiB||!has(0,13)||!['GIF87a','GIF89a'].includes(text(0,6)))throw invalid();width=v.getUint16(6,true);height=v.getUint16(8,true);if(!width||!height||width>2048||height>2048)throw invalid();
  let p=13,blocks=0;frames=0;if(bytes[10]&128)p+=3*(1<<((bytes[10]&7)+1));
  const subblocks=()=>{while(true){if(++blocks>100000||!has(p,1))throw invalid();const size=bytes[p++];if(!size)return;if(!has(p,size))throw invalid();p+=size;}};
  let ended=false;while(p<n){if(++blocks>100000)throw invalid();const tag=bytes[p++];if(tag===0x3b){ended=p===n;break;}if(tag===0x21){if(!has(p,1))throw invalid();const label=bytes[p++];if(label===0xf9){if(!has(p,6)||bytes[p]!==4||bytes[p+5]!==0)throw invalid();p+=6;}else{if(label===0xff&&(!has(p,1)||bytes[p]!==11))throw invalid();if(label===0x01&&(!has(p,1)||bytes[p]!==12))throw invalid();subblocks();}}else if(tag===0x2c){if(!has(p,9))throw invalid();const x=v.getUint16(p,true),y=v.getUint16(p+2,true),w=v.getUint16(p+4,true),h=v.getUint16(p+6,true),flags=bytes[p+8];if(!w||!h||x+w>width||y+h>height)throw invalid();p+=9;if(flags&128)p+=3*(1<<((flags&7)+1));if(!has(p,1)||bytes[p]<2||bytes[p]>8)throw invalid();p++;subblocks();frames++;if(frames>240||width*height*frames>60000000)throw new Error('GIF слишком сложный: максимум 240 кадров и 60 млн пикселей');}else throw invalid();}if(!ended||!frames)throw invalid();
 }else throw new Error('Выберите PNG, JPEG, WebP или GIF для обложки');
 if(!width||!height||width>8192||height>8192||width*height>32000000)throw new Error('Размер изображения: максимум 8192 × 8192 и 32 млн пикселей');
 if(orientation>=5)[width,height]=[height,width];
 return {width,height,mime,frames};
}
export async function readImageSource(file:File,kind:ImageKind){
 if(file.size>20*MiB||file.size<=0)throw new Error('Изображение должно быть не больше 20 МБ');
 if(!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type))throw new Error('Выберите PNG, JPEG, WebP или GIF для обложки');
 if(file.type==='image/gif'&&kind==='avatar')throw new Error('Для аватара выберите статическое изображение PNG, JPEG или WebP. GIF не поддерживается');
 if(file.type==='image/gif'&&file.size>2*MiB)throw new Error('GIF должен быть не больше 2 МБ');
 const bytes=new Uint8Array(await file.arrayBuffer());return {bytes,info:inspectImage(bytes,file.type,kind)};
}
export function bytesDataUrl(bytes:Uint8Array,mime:string){let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));return `data:${mime};base64,${btoa(binary)}`;}
export async function prepareCroppedImage(file:File,kind:ImageKind,crop:NormalizedCrop):Promise<PreparedProfileImage>{
 const {bytes,info}=await readImageSource(file,kind);const normalized=validateCrop(crop,info.width,info.height,kind==='avatar'?1:3);
 if(info.mime==='image/gif')return {dataUrl:bytesDataUrl(bytes,info.mime),width:info.width,height:info.height,mime:info.mime,crop:normalized};
 const bitmap=await createImageBitmap(new Blob([bytes as BlobPart],{type:info.mime}),{imageOrientation:'from-image'});
 try{
  if(bitmap.width!==info.width||bitmap.height!==info.height)throw invalid();
  const width=kind==='avatar'?256:1200,height=kind==='avatar'?256:400,canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d');if(!ctx)throw invalid();ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
  ctx.drawImage(bitmap,normalized.x*info.width/100,normalized.y*info.height/100,normalized.width*info.width/100,normalized.height*info.height/100,0,0,width,height);
  const cap=kind==='avatar'?256*1024:2*MiB;
  const options: Array<[string,number|undefined]>=kind==='avatar'?[['image/png',undefined]]:[['image/webp',0.9],['image/webp',0.75],['image/jpeg',0.85],['image/jpeg',0.65],['image/png',undefined]];
  for(const [mime,quality] of options){const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,mime,quality));if(blob&&blob.size<=cap){const dataUrl=bytesDataUrl(new Uint8Array(await blob.arrayBuffer()),blob.type);return {dataUrl,width,height,mime:blob.type,crop:{x:0,y:0,width:100,height:100}};}}
  throw new Error('Не удалось уменьшить изображение до допустимого размера');
 }finally{bitmap.close();}
}
