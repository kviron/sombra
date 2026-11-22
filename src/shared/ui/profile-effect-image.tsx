import {useEffect,useState} from 'react';
import {type ProfileEffectAsset} from '@/shared/api/backend';
import {sessionService} from '@/shared/api';
import {fileService} from '@/shared/api';

export const PROFILE_EFFECT_MAX_BYTES=2*1024*1024;
type EffectFile={asset:ProfileEffectAsset;data:string};
const pending=new Map<string,Promise<EffectFile>>();
function load(id:string,token:string):Promise<EffectFile>{
 const key=JSON.stringify([token,id]);
 const existing=pending.get(key);if(existing)return existing;
 const request=fileService.profileEffect<EffectFile>(id).finally(()=>pending.delete(key));
 pending.set(key,request);return request;
}
export function ProfileEffectImage({asset,className}:{asset?:ProfileEffectAsset;className?:string}){
 const [image,setImage]=useState<{id:string;url:string}>();
 const id=asset?.id,size=asset?.size;
 useEffect(()=>{
  if(!id||!size||size>PROFILE_EFFECT_MAX_BYTES||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  let active=true,url='';const token=sessionService.token();
  void load(id,token).then(result=>{
   if(!active||sessionService.token()!==token||result.asset.id!==id||result.asset.mime!=='image/gif'||result.data.length>4*Math.ceil(size/3))return;
   const raw=atob(result.data);if(raw.length!==size||!/^GIF8[79]a/.test(raw))return;
   url=URL.createObjectURL(new Blob([Uint8Array.from(raw,c=>c.charCodeAt(0))],{type:'image/gif'}));setImage({id,url});
  }).catch(()=>{});
  return()=>{active=false;if(url)URL.revokeObjectURL(url)};
 },[id,size]);
 return image&&id===image.id?<img className={className} src={image.url} alt="" aria-hidden="true" draggable={false}/>:null;
}
