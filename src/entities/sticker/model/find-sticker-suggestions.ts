import type {Sticker} from '@/shared/types';

function normalizedWords(text:string){
 return text.toLowerCase().replaceAll('ё','е').match(/[\p{L}\p{N}]+/gu)?.join(' ')||'';
}

export function findStickerSuggestions(draft:string,stickers:Sticker[],user:string,group?:string){
 const text=normalizedWords(draft);
 if(text.length<2)return [];
 const matches=[];
 for(const sticker of stickers){
  if(sticker.archived||(sticker.group?sticker.group!==group:sticker.owner!==user&&sticker.packInstalled!==true))continue;
  let longest=0;
  for(const keyword of [sticker.name,...sticker.keywords||[]]){
   const phrase=normalizedWords(keyword);
   if(phrase.length>longest&&(text===phrase||text.endsWith(' '+phrase)))longest=phrase.length;
  }
  if(longest)matches.push({sticker,length:longest,replaceDraft:longest===text.length});
 }
 return matches.sort((a,b)=>b.length-a.length).slice(0,12);
}
