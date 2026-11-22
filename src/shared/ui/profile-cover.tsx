import {useEffect,useRef,useState} from 'react';
import {type User,type ProfileCoverMetadata,type ProfileCoverFile} from '@/shared/types';
import {sessionService} from '@/shared/api';
import {fileService} from '@/shared/api';
import {AvatarFrame,normalizeDecoration,type DecorationInput} from '@/shared/ui/avatar-fx';
import {inspectImage} from '@/shared/lib/image-crop';
import './profile-cover.css';
import {ProfileEffectImage} from './profile-effect-image';
import type {ProfileEffectAsset} from '@/shared/types';
const LIMIT=2*1024*1024;
function valid(meta:ProfileCoverMetadata):boolean {
 const c=meta?.crop;
 return !!meta&&typeof meta.id==='string'&&['image/png','image/jpeg','image/webp','image/gif'].includes(meta.mime)&&Number.isInteger(meta.bytes)&&meta.bytes>0&&meta.bytes<=LIMIT&&Number.isFinite(meta.width)&&Number.isFinite(meta.height)&&meta.width>0&&meta.height>0&&!!c&&[c.x,c.y,c.width,c.height].every(Number.isFinite)&&c.x>=0&&c.y>=0&&c.width>0&&c.height>0&&c.x+c.width<=100.01&&c.y+c.height<=100.01&&Math.abs(meta.width*c.width/(meta.height*c.height)-3)<0.02;
}
export function ProfileCover({user,accountId,className='',decoration,effectAsset=user.profileEffectAssets?.cover}:{user:User;accountId:string;className?:string;decoration?:DecorationInput|null;effectAsset?:ProfileEffectAsset|null}) {
 /**
  * A `decorations.cover` document can do one of two things: `mode:"scene"` replaces the whole banner with the
  * opaque pixel scene, while a `frame` document (aurora) is drawn as a light overlay on top of the picture.
  * Without a document the old picture cover (or the gradient fallback) is shown exactly as before.
  */
 const decor=decoration===undefined?user.decorations?.cover:decoration;
 const scene=normalizeDecoration(decor,{target:'cover'}).value?.mode==='scene';
 const [image,setImage]=useState<{key:string;url:string}>();
 const latest=useRef(user.cover);latest.current=user.cover;
 const key=JSON.stringify([accountId,user.id,user.cover?.id]);
 useEffect(()=>{
  let active=true,url:string|undefined;const meta=latest.current,token=sessionService.token();setImage(undefined);
  // The scene is opaque and covers the whole banner: the picture is neither needed nor fetched.
  if(!scene&&meta&&valid(meta))void fileService.cover<ProfileCoverFile>({user:user.id,coverId:meta.id}).then(file=>{
   if(!active||sessionService.token()!==token)return;
   if(!file||!valid(file)||file.user!==user.id||file.id!==meta.id||file.mime!==meta.mime||file.bytes!==meta.bytes||file.width!==meta.width||file.height!==meta.height||file.animated!==meta.animated||JSON.stringify(file.crop)!==JSON.stringify(meta.crop)||typeof file.data!=='string'||file.data.length>4*Math.ceil(LIMIT/3)||! /^[A-Za-z0-9+/]*={0,2}$/.test(file.data))return;
   const raw=atob(file.data);if(raw.length!==meta.bytes)return;
   const bytes=Uint8Array.from(raw,char=>char.charCodeAt(0));
   const info=inspectImage(bytes,meta.mime,'cover');
   if(info.width!==meta.width||info.height!==meta.height||(info.frames>1)!==meta.animated)return;
   url=URL.createObjectURL(new Blob([bytes],{type:meta.mime}));
   if(active&&sessionService.token()===token)setImage({key,url});else {URL.revokeObjectURL(url);url=undefined;}
  }).catch(()=>{/* Keep the decorative fallback on unavailable or invalid covers. */});
  return()=>{active=false;if(url)URL.revokeObjectURL(url)};
 // Metadata objects are replaced by polling; only an actual cover version changes the image.
 },[accountId,user.id,user.cover?.id,scene]);
 const meta=user.cover,crop=meta&&valid(meta)?meta.crop:undefined;
 return <div className={`profile-cover ${className}`} aria-hidden="true">
  {effectAsset&&<ProfileEffectImage asset={effectAsset} className="profile-cover-effect"/>}
   {scene
   ? decor&&<AvatarFrame decoration={decor} target="cover"/>
   : <>{image?.key===key&&crop?<img src={image.url} alt="" draggable={false} style={{width:`${10000/crop.width}%`,height:`${10000/crop.height}%`,left:`${-100*crop.x/crop.width}%`,top:`${-100*crop.y/crop.height}%`}}/>:<><span className="profile-cover-glow"/><span className="profile-cover-grid"/></>}{decor&&<AvatarFrame decoration={decor} target="cover"/>}</>}
 </div>;
}
