import {useEffect,useRef,useState} from 'react';
import {api,type ChatState,type ProfileDecorationDoc,type User} from '@/shared/api/backend';
import {AvatarFrame,DECORATION_PRESETS,normalizeDecoration} from '@/shared/ui/avatar-fx';
import {UserAvatar} from '@/shared/ui/user-avatar';
import {Button} from '@/shared/ui/button';
import './profile-decoration-picker.css';

/**
 * «Украшение профиля»: choose a pixel-art avatar frame and a cover scene, preview both live and save through
 * `set_profile_decoration`. The documents are the shared v1 presets — the server re-validates the white list.
 * Nothing is applied optimistically: the radios show the draft, the saved state comes back from `refresh()`.
 */

type AvatarChoice='none'|'ember'|'slime';
type CoverChoice='none'|'runner'|'aurora';
type Target='avatar'|'cover';
type SaveStep={target:Target;decoration:ProfileDecorationDoc|null};

function doc(value:unknown):ProfileDecorationDoc|null{return value?value as ProfileDecorationDoc:null}

const AVATAR_DOCS:Record<AvatarChoice,ProfileDecorationDoc|null>={
 none:null,
 ember:doc(DECORATION_PRESETS['ember-crown'].decoration),
 slime:doc(DECORATION_PRESETS['slime-pet'].decoration),
};
const COVER_DOCS:Record<CoverChoice,ProfileDecorationDoc|null>={
 none:null,
 runner:doc(DECORATION_PRESETS['runner-cover'].decoration),
 aurora:doc(DECORATION_PRESETS['aurora-cover'].decoration),
};

const AVATAR_OPTIONS:{id:AvatarChoice;title:string;description:string}[]=[
 {id:'none',title:'Без рамки',description:'Обычный аватар, без анимации.'},
 {id:'ember',title:'Огненная рамка',description:'Огненное кольцо по краю аватара, лицо открыто.'},
 {id:'slime',title:'Слайм в углу',description:'Прыгающий пиксельный слайм в правом нижнем углу.'},
];
const COVER_OPTIONS:{id:CoverChoice;title:string;description:string}[]=[
 {id:'none',title:'Без сцены',description:'Обычная обложка или градиент, если картинки нет.'},
 {id:'runner',title:'Сцена «Бегущий герой»',description:'Вся обложка — ночное небо, холмы и бегущий силуэт.'},
 {id:'aurora',title:'Звёздное сияние',description:'Северное сияние поверх обложки.'},
];

/** Which preset does the saved document correspond to (the server allows nothing outside this list). */
function detectAvatar(me:User):AvatarChoice{
 const effect=normalizeDecoration(me.decorations?.avatar,{target:'avatar'}).value?.layers[0]?.effect;
 if(effect==='holy/divine-shield')return 'ember';
 if(effect==='critters/slime')return 'slime';
 return 'none';
}
function detectCover(me:User):CoverChoice{
 const value=normalizeDecoration(me.decorations?.cover,{target:'cover'}).value;
 if(!value)return 'none';
 if(value.mode==='scene')return 'runner';
 return value.layers.some(layer=>layer.effect==='weather/aurora')?'aurora':'none';
}

export function ProfileDecorationPicker({state,refresh}:{state:ChatState|null;refresh:()=>Promise<unknown>}){
 const me=state?.me;
 const supported=!!me&&(me.decorationSupported??state?.decorationSupported??false);
 const savedKey=me?JSON.stringify([me.decorations?.avatar??null,me.decorations?.cover??null]):'';
 const savedId=me?.id||'';
 const [avatarChoice,setAvatarChoice]=useState<AvatarChoice>('none');
 const [coverChoice,setCoverChoice]=useState<CoverChoice>('none');
 const [savedAvatar,setSavedAvatar]=useState<AvatarChoice>('none');
 const [savedCover,setSavedCover]=useState<CoverChoice>('none');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[]);
 // The poll replaces `state` every couple of seconds; only an actual server-side change resets the draft.
 useEffect(()=>{
  if(!me)return;
  const avatar=detectAvatar(me),cover=detectCover(me);
  setAvatarChoice(avatar);setSavedAvatar(avatar);
  setCoverChoice(cover);setSavedCover(cover);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `savedKey` names the two documents, `savedId` the account.
 },[savedKey,savedId]);
 const avatarDoc=AVATAR_DOCS[avatarChoice];
 const coverDoc=COVER_DOCS[coverChoice];
 const dirty=avatarChoice!==savedAvatar||coverChoice!==savedCover;
 const hasSaved=!!me?.decorations?.avatar||!!me?.decorations?.cover;
 async function run(steps:SaveStep[],success:string){
  setBusy(true);setError('');setNotice('');
  try{
   for(const step of steps)await api('set_profile_decoration',step);
   if(mounted.current)setNotice(success);
  }catch(e){
   if(mounted.current)setError(`Не удалось сохранить украшение: ${(e as Error).message}`);
  }finally{
   // The server answer is the only source of truth, including after a half-finished sequence.
   try{await refresh()}catch{/* the regular poll retries; keep the error text visible */}
   if(mounted.current)setBusy(false);
  }
 }
 async function save(){
  if(!me||busy)return;
  const steps:SaveStep[]=[];
  if(avatarChoice!==savedAvatar)steps.push({target:'avatar',decoration:avatarDoc});
  if(coverChoice!==savedCover)steps.push({target:'cover',decoration:coverDoc});
  if(!steps.length)return;
  await run(steps,'Украшение сохранено');
 }
 async function clear(){
  if(!me||busy)return;
  const steps:SaveStep[]=[];
  if(me.decorations?.avatar)steps.push({target:'avatar',decoration:null});
  if(me.decorations?.cover)steps.push({target:'cover',decoration:null});
  if(!steps.length)return;
  await run(steps,'Украшение убрано');
 }
 if(!me)return null;
 return <section className="decoration-picker" aria-labelledby="decoration-heading" data-avatar-choice={avatarChoice} data-cover-choice={coverChoice} data-saved-avatar={savedAvatar} data-saved-cover={savedCover} data-dirty={dirty?'true':'false'}>
  <h2 id="decoration-heading">Украшение профиля</h2>
  {!supported
   ? <p className="settings-hint">Украшения появятся после обновления сервера. Рамки и сцены рисуются на устройстве и не загружают файлы.</p>
   : <>
  <p className="settings-hint">Рамка аватара и сцена обложки рисуются на устройстве из короткого описания. Настройка видна всем, кто открывает ваш профиль; аватар и обложку можно менять как раньше.</p>
  <div className="decoration-preview">
   <div className="decoration-preview-cell">
    <div className="decoration-preview-avatar" data-decoration-preview="avatar" data-empty={avatarDoc?'false':'true'}>
     <UserAvatar user={me} size="xl" presence={false} decorative decoration={avatarDoc}/>
    </div>
    <span className="decoration-preview-label">Аватар: {AVATAR_OPTIONS.find(option=>option.id===avatarChoice)?.title.toLowerCase()}</span>
   </div>
   <div className="decoration-preview-cell is-wide">
    <div className="decoration-preview-cover" data-decoration-preview="cover" data-empty={coverDoc?'false':'true'}>
     {coverDoc?<AvatarFrame decoration={coverDoc} target="cover"/>:<><span className="decoration-preview-glow"/><span className="decoration-preview-grid"/></>}
    </div>
    <span className="decoration-preview-label">Обложка: {COVER_OPTIONS.find(option=>option.id===coverChoice)?.title.toLowerCase()}</span>
   </div>
  </div>
  <fieldset className="decoration-options" data-decoration-group="avatar">
   <legend>Рамка аватара</legend>
   {AVATAR_OPTIONS.map(option=><label key={option.id} className="decoration-option" data-selected={avatarChoice===option.id?'true':'false'}>
    <input type="radio" name="sombra-avatar-decoration" value={option.id} checked={avatarChoice===option.id} disabled={busy}
     onChange={()=>{setAvatarChoice(option.id);setError('');setNotice('')}}/>
    <span className="decoration-option-swatch" data-swatch={option.id} aria-hidden="true"/>
    <span className="decoration-option-text"><strong>{option.title}</strong><small>{option.description}</small></span>
   </label>)}
  </fieldset>
  <fieldset className="decoration-options" data-decoration-group="cover">
   <legend>Обложка</legend>
   {COVER_OPTIONS.map(option=><label key={option.id} className="decoration-option" data-selected={coverChoice===option.id?'true':'false'}>
    <input type="radio" name="sombra-cover-decoration" value={option.id} checked={coverChoice===option.id} disabled={busy}
     onChange={()=>{setCoverChoice(option.id);setError('');setNotice('')}}/>
    <span className="decoration-option-swatch" data-swatch={option.id} aria-hidden="true"/>
    <span className="decoration-option-text"><strong>{option.title}</strong><small>{option.description}</small></span>
   </label>)}
  </fieldset>
  {error&&<p className="decoration-error" role="alert">{error}</p>}
  {notice&&<p className="decoration-notice" role="status">{notice}</p>}
  <div className="decoration-actions">
   <Button type="button" variant="secondary" size="sm" disabled={busy||!dirty} onClick={()=>void save()}>{busy?'Сохраняем…':'Сохранить украшение'}</Button>
   <Button type="button" variant="ghost" size="sm" disabled={busy||!hasSaved} onClick={()=>void clear()}>Убрать</Button>
  </div>
   </>}
 </section>;
}
