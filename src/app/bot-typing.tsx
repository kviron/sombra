import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {ChatState,User} from '@/shared/api/backend';
import {UserAvatar} from '@/shared/ui/user-avatar';
import {Message,MessageAvatar,MessageContent,MessageHeader,Bubble,BubbleContent} from '@/shared/ui/message';
import {ImageGeneration,JobProgress,TypingIndicator} from '@/shared/ui/elements-progress';
import './bot-typing.css';

/**
 * Live bot activity comes from the server's `state.botTyping[]`:
 *
 *   {bot, channel, until, started_at, activity, status}
 *
 * `started_at` is Unix **seconds**, `activity` is a **code** from the enum below and
 * `status` is a ready short label. The transport still opens an eight-second window per
 * update and carries no stage weights, no prompt and no verified percentage.
 *
 * An older worker may still send the pre-enum `stage` / `startedAt` pair, so every field
 * is read through the safe parser instead of widening the public `ChatState` DTO. That
 * keeps an older or newer server from breaking compilation or rendering, and it keeps
 * this module inside its own zone (the shared API types are owned elsewhere).
 */
type BotTypingEntry={bot:string;channel:string;until:number};

/** Activity codes → the short Russian labels the chat shows (status overrides them). */
const ACTIVITY_LABELS:Record<string,string>={
 thinking:'Думает',
 tool:'Выполняет инструмент',
 image:'Генерирует изображение',
 search:'Ищет',
 code:'Пишет код',
 waiting:'Ожидает ответа сервиса',
};
const NEUTRAL_STAGE='работает…';
const IMAGE_ACTIVITY_FALLBACK='Генерирую изображение…';
const IMAGE_MIMES=new Set(['image/gif','image/png','image/jpeg','image/webp']);

/** One short stage line; anything longer is kept for the expandable detail. */
function readText(value:unknown,limit:number):string{
 if(typeof value!=='string')return '';
 const text=value.replace(/\s+/g,' ').trim();
 if(!text)return '';
 return text.length>limit?`${text.slice(0,limit-1)}…`:text;
}

/** Only the documented enum codes are translated; free text stays free text (legacy). */
function readCode(value:unknown):string{
 if(typeof value!=='string')return '';
 const code=value.trim().toLowerCase();
 return Object.prototype.hasOwnProperty.call(ACTIVITY_LABELS,code)?code:'';
}

/** Optional start moment in milliseconds; unix seconds and ISO strings are accepted. */
function readTimestamp(value:unknown):number|undefined{
 let ms=Number.NaN;
 if(typeof value==='number')ms=value;
 else if(typeof value==='string'&&value.trim()){
  const numeric=Number(value);
  ms=Number.isFinite(numeric)?numeric:Date.parse(value);
 }
 if(!Number.isFinite(ms)||ms<=0)return undefined;
 if(ms<1e11)ms*=1000;
 return Math.min(ms,Date.now());
}

type BotActivity={
 /** Enum code when the worker reports one; '' for legacy free text. */
 code:string;
 /** Ready label from the worker; takes priority over every derived label. */
 status:string;
 /** Line shown on the compact row: status → mapped code → legacy stage → free text. */
 stage:string;
 /** Long text behind the expand control; never the enum code itself. */
 detail:string;
 /** Epoch milliseconds from `started_at` (or the legacy `startedAt`). */
 startedAt:number|undefined;
};

function readActivity(entry:BotTypingEntry):BotActivity{
 // Extra fields are read defensively: a future or older server can never crash a render.
 const fields=entry as unknown as Record<string,unknown>;
 const code=readCode(fields.activity);
 const status=readText(fields.status,48);
 const legacyStage=readText(fields.stage,48);
 // A free-text `activity` is the pre-enum worker's stage sentence, never a code.
 const legacyActivity=code?'':readText(fields.activity,48);
 const stage=status||(code?ACTIVITY_LABELS[code]:'')||legacyStage||legacyActivity;
 const freeText=code?'':readText(fields.activity,240);
 const detail=readText(fields.detail,240)||readText(fields.description,240)||(freeText&&freeText!==stage?freeText:'');
 return {code,status,stage,detail,startedAt:readTimestamp(fields.started_at)??readTimestamp(fields.startedAt)};
}

/** Live entries for one channel: an expired window is never rendered. */
function activeEntries(state:Pick<ChatState,'botTyping'>,channel:string,now:number):BotTypingEntry[]{
 return (state.botTyping||[]).filter(item=>item.channel===channel&&Number.isFinite(item.until)&&item.until>now);
}

/**
 * A picture this bot already delivered inside the current generation window hides the
 * card at once, without waiting for the next poll. `started_at` and message times are
 * both server seconds, so this needs no clock agreement with the device; without it the
 * card simply lives until the entry itself is cleared.
 */
function imageDelivered(state:Pick<ChatState,'messages'>,entry:BotTypingEntry):boolean{
 const startMs=readActivity(entry).startedAt;
 if(startMs===undefined)return false;
 return (state.messages||[]).some(message=>message.channel===entry.channel&&message.user===entry.bot&&!!message.attachment&&IMAGE_MIMES.has(message.attachment.mime)&&message.time*1000>=startMs);
}

/**
 * True while the transcript really shows the live image-generation card for this channel.
 * The chat shell uses it to keep a single activity signal: the card replaces the composer
 * status row and its typing dots while it is on screen.
 */
export function hasLiveImageActivity(state:Pick<ChatState,'botTyping'|'messages'>,channel:string,now=Date.now()/1000):boolean{
 const entry=activeEntries(state,channel,now).find(item=>readActivity(item).code==='image');
 return !!entry&&!imageDelivered(state,entry);
}

/**
 * Expiry clock shared by the compact row and the image card: they disappear on their
 * own without waiting for the next state poll and without re-rendering the chat shell.
 */
function useTypingExpiry(keys:string,earliestUntil:number|undefined):number{
 const [now,setNow]=useState(()=>Date.now()/1000);
 useEffect(()=>{
  if(earliestUntil===undefined||!Number.isFinite(earliestUntil))return;
  // Already past this window: the caller renders nothing, so no timer is armed and the
  // clock cannot spin.
  if(earliestUntil*1000<=Date.now())return;
  const timer=setTimeout(()=>setNow(Date.now()/1000),Math.max(60,earliestUntil*1000-Date.now()+25));
  return()=>clearTimeout(timer);
 },[keys,earliestUntil,now]);
 return now;
}

/** Stable identity of every live window; a replaced entry restarts the expiry clock. */
function typingKeys(state:Pick<ChatState,'botTyping'>):string{
 return (state.botTyping||[]).map(item=>`${item.bot}@${item.until}`).join('|');
}

/** Nearest expiry in this channel, so one timer covers the row and the image card. */
function earliestUntil(state:Pick<ChatState,'botTyping'>,channel:string):number|undefined{
 return (state.botTyping||[]).filter(item=>item.channel===channel).reduce<number|undefined>(
  (earliest,item)=>earliest===undefined||item.until<earliest?item.until:earliest,
  undefined,
 );
}

function botIdentity(state:ChatState,id:string):{name:string;user?:User}{
 const user=state.users.find(item=>item.id===id);
 const bot=state.bots?.find(item=>item.id===id);
 return {name:user?.name||bot?.name||'Сомбра',user:user&&(user.bot||!!bot)?user:undefined};
}

export function typingBotNames(state:Pick<ChatState,'botTyping'|'users'>,channel:string,now=Date.now()/1000):string[]{
 const ids=new Set(activeEntries(state,channel,now).map(item=>item.bot));
 return state.users.filter(user=>user.bot&&ids.has(user.id)).map(user=>user.name);
}

/**
 * A single pinned activity row above the composer:
 *  * the official Elements TypingIndicator plus the bot avatar (item 3),
 *  * the compact Elements JobProgress line with the bot's `status` (or the label mapped
 *    from its `activity` code) when present, otherwise the neutral "работает…" and the
 *    elapsed time measured from `started_at` (item 4).
 * The row is keyed to its bot and channel, so foreign messages never move it and it
 * disappears as soon as the typing window expires, the bot replies, an error drops the
 * entry, or the conversation changes.
 */
export function BotTyping({state,channel}:{state:ChatState;channel:string}){
 const now=useTypingExpiry(typingKeys(state),earliestUntil(state,channel));
 const entries=activeEntries(state,channel,now);
 const entry=entries[0];
 const key=entry?`${channel}:${entry.bot}`:'';
 // Elapsed time exists even when the worker reports no start: the row measures from
 // the moment this continuous activity was first observed, never a guessed percent.
 const [observedStart,setObservedStart]=useState(0);
 useEffect(()=>{setObservedStart(key?Date.now():0)},[key]);
 if(!entry)return null;
 const {name,user:bot}=botIdentity(state,entry.bot);
 const activity=readActivity(entry);
 const stage=activity.stage||NEUTRAL_STAGE;
 const startedAt=activity.startedAt??(observedStart||undefined);
 const announcement=activity.stage?`${name} печатает: ${activity.stage}`:`${name} печатает…`;
 return <div className="bot-typing" role="status" aria-live="polite" aria-atomic="false">
  <span className="bot-typing-announce">{announcement}</span>
  <JobProgress className="bot-typing-job" title={name} stage={stage} detail={activity.detail||undefined} startedAt={startedAt}/>
  {/* The live region above owns the announcement; the animated dots stay decorative. */}
  <span className="bot-typing-indicator" aria-hidden="true">
   {bot?<UserAvatar user={bot} size="sm" presence={false} decorative/>:null}
   <TypingIndicator variant="bubble" label={announcement} className="bot-typing-bubble"/>
  </span>
 </div>;
}

/**
 * The "not yet arrived" message at the end of the transcript while the bot in this
 * channel reports `activity: "image"`. It is the vendored Elements ImageGeneration card
 * inside the normal message composition, so it lines up with the pictures that replace
 * it. It lives only as long as the live `botTyping` entry:
 *  * a real image message from the same bot in the same channel hides it immediately
 *    (no waiting for the next poll, no duplicate card next to the delivered picture),
 *  * an expired window, a dropped entry or a different conversation removes it,
 *  * it never invents a prompt, a resolution or a percentage — the only text is the
 *    worker's `status` (or «Генерирую изображение…»),
 *  * if the reader was at the bottom the transcript follows it; a person reading further
 *    up is not pulled down.
 */
export function BotImageActivity({state,channel}:{state:ChatState;channel:string}){
 const now=useTypingExpiry(typingKeys(state),earliestUntil(state,channel));
 const entries=activeEntries(state,channel,now).filter(item=>readActivity(item).code==='image');
 const entry=entries[0];
 const root=useRef<HTMLDivElement>(null);
 useLayoutEffect(()=>{
  if(!entry)return;
  const element=root.current;
  if(!element)return;
  let scroller:HTMLElement|null=element.parentElement;
  while(scroller&&!/(auto|scroll)/.test(getComputedStyle(scroller).overflowY))scroller=scroller.parentElement;
  if(!scroller)return;
  // The card is already inserted, so "was at the bottom" means the remaining distance is
  // about its own height. Anything further up is a person reading history: leave it.
  const distance=scroller.scrollHeight-scroller.scrollTop-scroller.clientHeight;
  if(distance<=element.offsetHeight+24)scroller.scrollTop=scroller.scrollHeight;
 },[entry?.bot,entry?.until]);
 if(!entry)return null;
 const {name,user:bot}=botIdentity(state,entry.bot);
 const activity=readActivity(entry);
 const label=activity.status||IMAGE_ACTIVITY_FALLBACK;
 if(imageDelivered(state,entry))return null;
 return <div ref={root} className="bot-image-activity" data-bot-image-activity={entry.bot}>
  <Message className="bot-image-message" align="start" aria-label={`${name}: ${label}`}>
   <MessageAvatar>{bot?<UserAvatar user={bot} size="md" presence={false} decorative/>:name[0]}</MessageAvatar>
   <MessageContent>
    <Bubble data-image-message="true">
     <MessageHeader><strong>{name}</strong><small className="bot-badge">БОТ</small></MessageHeader>
     <BubbleContent><ImageGeneration prompt={label} generating className="bot-image-generation"/></BubbleContent>
    </Bubble>
   </MessageContent>
  </Message>
 </div>;
}
