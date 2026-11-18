// Real source React LiveChat with an explicit synthetic API boundary.
// Verifies the bot image-activity card: it lives at the end of the transcript while the
// bot in the current channel reports activity:"image", it disappears when the picture
// arrives/expires/the channel changes, and it never invents a prompt, a resolution or a
// percentage. Also re-checks the status row: one per channel, one in the composer dock.
// No backend, provider, production or native claim.
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import net from 'node:net';

const out=`bot-image-qa/run-${Date.now()}`,checks=[],metrics=[],socketList=[];
mkdirSync(out,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(f,label){let last;for(let i=0;i<300;i++){try{const v=await f();if(v)return v}catch(e){last=e}await sleep(100)}throw Error(`Timeout ${label} ${last?.message||''}`)}
const port=()=>new Promise((r,j)=>{const s=net.createServer();s.once('error',j);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p))})});
function ok(value,label){assert(value,label);checks.push(label);console.log(`PASS ${label}`)}
async function connect(url){
 const ws=new WebSocket(url);socketList.push(ws);
 await new Promise(r=>ws.addEventListener('open',r,{once:true}));
 let id=0;const pending=new Map();
 ws.addEventListener('message',event=>{const message=JSON.parse(event.data),wait=pending.get(message.id);if(!wait)return;pending.delete(message.id);message.error?wait[1](Error(message.error.message)):wait[0](message.result)});
 const send=(method,params={})=>new Promise((r,j)=>{const n=++id;pending.set(n,[r,j]);ws.send(JSON.stringify({id:n,method,params}))});
 const ev=async expression=>{const value=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(value.exceptionDetails)throw Error(JSON.stringify(value.exceptionDetails));return value.result.value};
 return {send,ev,wait:expression=>until(()=>ev(expression),expression)};
}

const NOW=Math.floor(Date.now()/1000);
const me={id:'owner_qa',name:'QA Owner',online:true,created_at:1};
const alice={id:'alice_member',name:'Alice Member',online:true,created_at:1};
// A tiny real PNG avatar so the card must render an avatar URL from state, not initials.
const avatarPng='iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAQxSURBVHhe5Zs/UOJKHMcpX3kl5ZVXWlJSWlJqAgQB82fBAxRP5fTg6fO4JziWlpaUlJSUVzJz2fz1zaSktKTcN7/wz1vRA8UQst+Zz9Co5LO7+WU3u4ZCK0hBMj7mpPto4RF50fxE/9zap1BwPiBkpRCyW3nF7uYVm+yN+CxPKYwoApJFiqL1syhZnaJoyGWEw/Tf9XUQwmFFsWVFsTs5ZBMAxOeWlyxSesQ+IFo/S6JZhJFDf59vgpC1ISt2ByGbAEuUJwcupkt51+weZIwo/f0riyQZHxXFvlNG4u8s73IIn1mrXc5aG/T1eBaEnLCC7m8UZA28lge+TLk78vrWkGU7IiP7AcRXKX+UHWMMvqT1Lfo63yUSslJKznZ73Q/yx484yRg1+nqXGnfI5+5dcd/Juw1gkkrGbFUF5y/62t8UeJ7Luf/aayBPKhmDnKSN3pGwxLog5+zOusgDX9OAblSF3gfaZeGsybCn5Iec7hgd2mehiDCjW1f5KXXaa65Iufuob6v9nPJnwI5OToUFH5EwyfHTc/4t8kO0QVXA888ahzO8YMh/m9KmPWcGFjWrnt4uW746RsCbtO+TyMhuB1G+lnLp0b6/Zdj7gZUnf6dgFGgx2nsSj9bzK5MHzpPPjAJY1wdeXhhyIcx4oYKQecyCvNsASf2W9g8hZHeZkHcbQHMoeRxmRl7QyT9DIpMGgLe4TMknNXKR0KYvT3KK3WFJ3iWhGZMGyCu2w5L85YjHDcCc/PekRurw1ggKIIvywA9ej7jTXxbl6wmNXMa1WGgPmZssygPfE5ocyktWikX5H8PPWuizaMssygP/8lotlFfMGJPycSiCajG0J9sRFuXdBoirW+5xFRblgQavDpfFLMpfxUcTIbcBRKvPmjww2UQtSWaPNfkrXnuYrAVKklVjSb7h3v/a3aQB9kXzE1vymFzFqT2C/V3LYUW+wamDJ4coDnatOhPyPCZNHrd+k4eUsnqEEXnS2FZn7xaXs4YRdPkmp/afDP9x9kUzFmh5KH4w/38ph7tmL6jyL/b+OIeiGQukPI/J9Z96f5yjrNUOoPzsTdFZgUPIwZLHpLn96/lt8Vk5zprFwMhz+Ib2mysnGfN23eWvOdz9Y+F7LvCLlbTZXVf5Joedm7eeFi0LOFzJ6M66yV9vq4MbboGjcS+lIuCNStror5P89dYcJ8IWSVXA4dO00fO7vDvsl9XzdKAmnO0YLb/KQ8F78z0/T84EfOw7+W18++pq/5p8FfDmtx29t2r5Jo+dZ5e3XqQq6Fu1lOZ4Ls+p/bnn9l6kKujF86Tef2/5BocfGrxa83S4zxv4F5VzQd+6SGqti6Q2WKZ8g8ftJodTnhS5ZeU8rsUuk9rdZULrLyzP48EVj1twf/uyt1+TuqBG67warcdxCvbmAdiiduE0GfbqAC+F/wd1vWUgaqyZSwAAAABJRU5ErkJggg==';
const botUser={id:'bot_sombra',name:'Сомбра',username:'hermes',bot:true,created_at:1,avatar:'data:image/png;base64,'+avatarPng};
const state={
 me,email:'qa@local.test',users:[me,alice,botUser],
 groups:[{id:'group_qa',name:'QA Group',owner:me.id,members:[me.id,alice.id],invite:'synthetic',channels:[{id:'text_qa',name:'qa-room',kind:'text'},{id:'voice_qa',name:'voice-room',kind:'voice'}]}],
 dialogs:[{id:'room_a',name:'QA Room',members:[me.id,alice.id,botUser.id]},{id:'room_b',name:'QA Other Room',members:[me.id,alice.id,botUser.id]}],
 messages:[
  ...Array.from({length:24},(_,i)=>({id:`m${i+1}`,channel:'room_a',user:i%2?botUser.id:alice.id,text:`Синтетическое сообщение ${i+1}: строка проверки прокрутки и раскладки`,time:NOW-3000+i*30})),
  {id:'b1',channel:'room_b',user:alice.id,text:'Другая переписка',time:NOW-100},
 ],
 stickers:[],friends:[],
 bots:[{...botUser,enabled:true,groups:['group_qa'],commands:[]}],
 dialogCalls:[],voicePresence:{},humanTypingSupported:true,humanTyping:[],readReceiptsSupported:true,
 chatPreferences:{revision:1,notifications:{direct:true,groups:true},dialogs:{}},botTyping:[],
};

const asciiJson=value=>JSON.stringify(value).replace(/[\u0080-\uffff]/g,character=>`\\u${character.charCodeAt(0).toString(16).padStart(4,"0")}`);
const init=`window.qaState=${asciiJson(state)};window.qaErrors=[];window.qaOps=[];
window.fetch=async(url,opts={})=>{if(!String(url).startsWith('/api'))throw Error('Unexpected fetch '+url);const body=JSON.parse(opts.body||'{}');qaOps.push(body.op);let data={};
if(body.op==='me')data=qaState.me;
if(body.op==='state'){if(window.qaFreeze)return new Response(JSON.stringify({data:structuredClone(window.qaFrozenState||qaState)}),{status:200,headers:{'content-type':'application/json'}});data=structuredClone(qaState)}
if(body.op==='sessions')data=[];
if(body.op==='attachment_file'){const c=document.createElement('canvas');c.width=320;c.height=320;const x=c.getContext('2d');x.fillStyle='#3b4a86';x.fillRect(0,0,320,320);x.fillStyle='#fff';x.font='20px sans-serif';x.fillText('Synthetic generated image',20,160);data={name:'synthetic-generated.png',mime:'image/png',data:c.toDataURL('image/png').split(',')[1]}}
if(body.op==='message'){const message={id:'sent_'+qaOps.length,channel:body.channel,user:qaState.me.id,text:body.text||'',time:Date.now()/1000};qaState.messages.push(message);data=message}
return new Response(JSON.stringify({data}),{status:200,headers:{'content-type':'application/json'}})};
addEventListener('error',event=>qaErrors.push(event.message));
addEventListener('unhandledrejection',event=>qaErrors.push(String(event.reason)));`;

let server,chrome,tab;
async function shot(name){const result=await tab.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${out}/${name}.png`,Buffer.from(result.data,'base64'))}
async function clickSelector(selector){
 await tab.wait(`!!document.querySelector(${JSON.stringify(selector)})`);
 const point=await tab.ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
 for(const type of ['mousePressed','mouseReleased'])await tab.send('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount:1});
 await sleep(250);
}
const setTyping=value=>tab.ev(`qaState.botTyping=${JSON.stringify(value)}`);
const openRoom=name=>tab.ev(`[...document.querySelectorAll('.dialog-list button')].find(e=>e.textContent.includes(${JSON.stringify(name)})).click()`);
const cardProbe=()=>tab.ev(`(()=>{const scroller=document.querySelector('.message-scroll');const card=document.querySelector('.bot-image-activity');if(!card||!scroller)return null;const rect=e=>{const r=e.getBoundingClientRect();return{top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height}};const element=card.querySelector('[data-slot="image-generation"]');const articles=[...scroller.querySelectorAll('article[data-message-id]')];const lastArticle=articles.at(-1);const plate=card.querySelector('.elements-image-plate');const dot=card.querySelector('[data-slot="image-generation"] span.rounded-full');const avatarImg=card.querySelector('.message-avatar .user-avatar img');return{text:card.innerText,labelCount:(card.innerText.match(/Генерирую изображение/g)||[]).length,rect:rect(card),element:element?rect(element):null,dots:element?element.querySelectorAll('span.rounded-full').length:0,insideScroll:scroller.contains(card),atEnd:lastArticle?(lastArticle.compareDocumentPosition(card)&Node.DOCUMENT_POSITION_FOLLOWING)!==0:true,avatar:!!card.querySelector('.message-avatar .user-avatar'),avatarImage:!!avatarImg,avatarSrc:avatarImg?String(avatarImg.getAttribute('src')).slice(0,24):'',header:card.querySelector('.message-meta')?.innerText||'',status:element?.parentElement?.querySelector('p')?.innerText||'',plateAnimation:plate?getComputedStyle(plate).animationName:'',plateSheen:plate?getComputedStyle(plate,'::after').content:'',plateBackground:plate?getComputedStyle(plate).backgroundImage.slice(0,18):'',dotPulse:dot?getComputedStyle(dot).animationName:'',scrollTop:scroller.scrollTop,scrollHeight:scroller.scrollHeight,clientHeight:scroller.clientHeight,dockCount:document.querySelectorAll('.composer-chrome .bot-typing').length,typingCount:document.querySelectorAll('.bot-typing').length,dotsIndicators:document.querySelectorAll('[data-slot="typing-indicator"]').length,progressRows:document.querySelectorAll('[data-slot="job-progress"]').length,dockText:document.querySelector('.composer-chrome .bot-typing')?.innerText||'',composerTop:document.querySelector('.composer-chrome')?.getBoundingClientRect().top??null,overflowX:scroller.scrollWidth>scroller.clientWidth,bodyWidth:document.documentElement.scrollWidth,viewport:innerWidth}})()`);

try{
 const webPort=await port(),debugPort=await port();
 server=await createServer({server:{host:'127.0.0.1',port:webPort,strictPort:true,watch:{ignored:['**/*-qa/**','**/target/**','**/data/**']}}});
 await server.listen();
 chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-sandbox','--disable-gpu','--mute-audio','--no-first-run','--remote-debugging-port='+debugPort,'--user-data-dir='+process.cwd()+'/'+out+'/browser','about:blank'],{stdio:'ignore',windowsHide:true});
 const pages=await until(async()=>{const list=await(await fetch(`http://127.0.0.1:${debugPort}/json`)).json();return list.length&&list},'CDP');
 tab=await connect(pages.find(page=>page.type==='page').webSocketDebuggerUrl);
 await tab.send('Page.enable');
 await tab.send('Emulation.setDeviceMetricsOverride',{width:1080,height:720,deviceScaleFactor:1,mobile:false});
 await tab.send('Page.addScriptToEvaluateOnNewDocument',{source:init});
 await tab.send('Page.navigate',{url:`http://127.0.0.1:${webPort}/#chat`});
 await tab.wait(`!!document.querySelector('.profile-name strong')`);
 await tab.wait(`!!document.querySelector('.dialog-list button')`);
 await openRoom('QA Room');
 await tab.wait(`!!document.querySelector('article[data-message-id]')`);
 await sleep(500);

 // 1. A live image activity renders the assistant-ui ImageGeneration card in the chat and
 //    is the only activity signal: no composer row and no typing dots next to it.
 const typingUntil=Math.floor(Date.now()/1000)+90,startedAt=Math.floor(Date.now()/1000)-4;
 await setTyping([{bot:'bot_sombra',channel:'room_a',until:typingUntil,started_at:startedAt,activity:'image',status:'Генерирую изображение…'}]);
 await tab.wait(`!!document.querySelector('.bot-image-activity [data-slot="image-generation"]')`);
 await sleep(900);
 const card=await cardProbe();
 metrics.push({label:'image card',...card});
 ok(!!card,'image activity renders the Elements ImageGeneration card');
 ok(card.insideScroll&&card.atEnd,'card sits at the end of the transcript as the next message');
 ok(card.avatar,'card shows the bot avatar like a real message');
 ok(card.avatarImage&&card.avatarSrc.startsWith('data:image'),`card renders the avatar URL from state (${card.avatarSrc})`);
 ok(/Сомбра/.test(card.header)&&/БОТ/.test(card.header),`card header names the bot and the bot badge (${card.header.replace(/\n/g,' | ')})`);
 ok(card.dots>=64,`canonical 8x8 dot field is rendered (${card.dots} dots)`);
 ok(card.status.includes('Генерирую изображение')&&card.labelCount===1,`card shows exactly one status label (${card.status})`);
 ok(!/1024|×|\d+\s*[x×]\s*\d+/i.test(card.text),'no invented resolution or dimensions');
 ok(!/%|прогресс/i.test(card.text),'no invented percentage or progress');
 ok(card.plateAnimation.includes('elements-image-breathe')&&card.plateSheen!=='none'&&card.plateBackground!=='none',`plate shows a soft Sombra gradient with a breathing animation and sheen (${card.plateAnimation}, ${card.plateBackground})`);
 ok(card.dotPulse.includes('animate-pulse')||card.dotPulse.includes('pulse'),`canonical dots keep pulsing (${card.dotPulse})`);
 ok(card.dockCount===0&&card.typingCount===0&&card.dotsIndicators===0&&card.progressRows===0,'the card replaces the composer status row and its typing dots');
 ok(card.rect.bottom<=card.composerTop-4,`card clears the floating composer (${card.rect.bottom.toFixed(1)} <= ${card.composerTop.toFixed(1)})`);
 await shot('image-card-1080');

 // 2. Arriving while the reader is at the bottom follows the card.
 const bottomDistance=await tab.ev(`(()=>{const s=document.querySelector('.message-scroll');return s.scrollHeight-s.scrollTop-s.clientHeight})()`);
 ok(bottomDistance<=8,`at-bottom reader is scrolled to the card (${bottomDistance}px)`);

 // 3. Arriving while the reader is above must not yank the transcript.
 await setTyping([]);await tab.wait(`!document.querySelector('.bot-image-activity')`);
 await tab.ev(`(()=>{const s=document.querySelector('.message-scroll');s.scrollTop=s.scrollHeight})()`);await sleep(200);
 await tab.ev(`(()=>{const s=document.querySelector('.message-scroll');s.scrollTop=Math.max(0,s.scrollTop-260)})()`);await sleep(400);
 const beforeScroll=await tab.ev(`document.querySelector('.message-scroll').scrollTop`);
 await setTyping([{bot:'bot_sombra',channel:'room_a',until:typingUntil,started_at:Math.floor(Date.now()/1000),activity:'image',status:'Генерирую изображение…'}]);
 await tab.wait(`!!document.querySelector('.bot-image-activity')`);
 await sleep(2600);
 const afterScroll=await tab.ev(`document.querySelector('.message-scroll').scrollTop`);
 metrics.push({label:'scroll while reading up',beforeScroll,afterScroll});
 ok(Math.abs(afterScroll-beforeScroll)<=4,`card does not jump a reader who is above (${beforeScroll} -> ${afterScroll})`);
 await shot('image-card-scrolled-up');

 // 4. The real picture replaces the card without waiting for the typing window to close.
 await tab.ev(`qaState.messages.push({id:'generated_png',channel:'room_a',user:'bot_sombra',text:'',time:Date.now()/1000,attachment:{id:'att_generated',name:'synthetic-generated.png',mime:'image/png',size:70,cached:false,expired:false}})`);
 await tab.wait(`!document.querySelector('.bot-image-activity')`);
 await tab.wait(`!!document.querySelector('[data-message-id="generated_png"] .attachment-image-trigger img')`);
 await sleep(600);
 const delivered=await tab.ev(`(()=>{const card=document.querySelector('.bot-image-activity');const message=document.querySelector('[data-message-id="generated_png"]');const dock=document.querySelector('.composer-chrome .bot-typing');return{card:!!card,picture:!!message?.querySelector('img'),dock:!!dock,dockText:dock?.innerText||'',typingCount:document.querySelectorAll('.bot-typing').length}})()`);
 metrics.push({label:'delivered picture',...delivered});
 ok(!delivered.card&&delivered.picture,'the delivered image message replaces the card');
 ok(delivered.typingCount===1,'the composer status row returns once the card is gone');
 await shot('image-delivered');

 // 5. The card leaves with the typing window even when the state poll is frozen.
 await tab.ev(`qaState.messages=qaState.messages.filter(m=>m.id!=='generated_png');qaState.botTyping=[]`);await sleep(2400);
 await setTyping([{bot:'bot_sombra',channel:'room_a',until:Math.floor(Date.now()/1000)+3,started_at:Math.floor(Date.now()/1000),activity:'image',status:'Генерирую изображение…'}]);
 await tab.wait(`!!document.querySelector('.bot-image-activity')`);
 await tab.ev(`window.qaFreeze=true`);await tab.ev(`window.qaFrozenState=structuredClone(qaState);window.qaFrozenState.botTyping=structuredClone(qaState.botTyping)`);
 const expiryStarted=Date.now();
 await tab.wait(`!document.querySelector('.bot-image-activity')`);
 metrics.push({label:'card expiry with frozen poll',elapsedMs:Date.now()-expiryStarted});
 ok(true,'card expires on its own while the state poll is frozen');
 await tab.ev(`window.qaFreeze=false;window.qaFrozenState=null`);await setTyping([]);await sleep(2400);

 // 6. Channel scoping: an entry in another conversation shows nothing, switching shows it.
 await setTyping([{bot:'bot_sombra',channel:'room_b',until:typingUntil,started_at:Math.floor(Date.now()/1000),activity:'image',status:'Генерирую изображение…'}]);
 await sleep(2600);
 ok(!(await tab.ev(`!!document.querySelector('.bot-image-activity')`)),'image activity from another conversation stays out of this transcript');
 await openRoom('QA Other Room');
 await tab.wait(`!!document.querySelector('.bot-image-activity')`);
 ok(true,'the card follows its own channel');
 await openRoom('QA Room');
 await tab.wait(`!document.querySelector('.bot-image-activity')`);
 ok(true,'leaving the channel removes the card');
 await setTyping([]);await sleep(2400);

 // 7. Activity codes map to Russian labels when the worker sends no status; the legacy
 //    pre-enum stage/startedAt pair still works and never renders a card.
 await setTyping([{bot:'bot_sombra',channel:'room_a',until:typingUntil,activity:'tool'}]);
 await tab.wait(`(document.querySelector('.composer-chrome .bot-typing')?.innerText||'').includes('Выполняет инструмент')`);
 ok(true,'activity code maps to the Russian label when no status is present');
 await setTyping([{bot:'bot_sombra',channel:'room_a',until:typingUntil,activity:'waiting'}]);
 await tab.wait(`(document.querySelector('.composer-chrome .bot-typing')?.innerText||'').includes('Ожидает ответа сервиса')`);
 ok(true,'a second activity code maps too');
 await setTyping([{bot:'bot_sombra',channel:'room_a',until:typingUntil,activity:'tool',status:'Проверяю файлы'}]);
 await tab.wait(`(document.querySelector('.composer-chrome .bot-typing')?.innerText||'').includes('Проверяю файлы')`);
 ok(true,'the worker status wins over the mapped code label for non-image activity');
 await setTyping([{bot:'bot_sombra',channel:'room_a',until:typingUntil,activity:'image'}]);
 await tab.wait(`!!document.querySelector('.bot-image-activity')`);
 ok(await tab.ev(`(document.querySelector('.bot-image-activity [data-slot="image-generation"] p')?.innerText||'').includes('Генерирую изображение')`),'card falls back to the localized generating label without a status');
 ok(await tab.ev(`!document.querySelector('.composer-chrome .bot-typing')`),'image activity without a status also hides the composer row');
 await setTyping([]);await sleep(2400);
 await setTyping([{bot:'bot_sombra',channel:'room_a',until:typingUntil,stage:'собирает контекст',startedAt:Date.now()-9000}]);
 await tab.wait(`!!document.querySelector('.composer-chrome .bot-typing')`);
 await sleep(1200);
 const legacy=await tab.ev(`(()=>{const row=document.querySelector('.composer-chrome .bot-typing');return{text:row?.innerText||'',time:row?.querySelector('time')?.textContent||'',card:!!document.querySelector('.bot-image-activity'),count:document.querySelectorAll('.bot-typing').length}})()`);
 metrics.push({label:'legacy stage',...legacy});
 ok(/собирает контекст/.test(legacy.text),`legacy stage text still renders (${legacy.text.replace(/\n/g,' | ')})`);
 ok(/\d/.test(legacy.time)&&legacy.count===1&&!legacy.card,'legacy startedAt drives the elapsed clock without a card');
 await setTyping([]);await sleep(2400);

 // 8. Voice channel: no card, exactly one status row in its own chat column.
 await clickSelector('.server-rail button[title="QA Group"]');
 await tab.ev(`[...document.querySelectorAll('.channel-list .channel')].find(e=>e.textContent.includes('voice-room')).click()`);
 await tab.wait(`!!document.querySelector('.voice-messages')`);
 await setTyping([{bot:'bot_sombra',channel:'voice_qa',until:typingUntil,started_at:Math.floor(Date.now()/1000),activity:'image',status:'Генерирую изображение…'}]);
 await tab.wait(`!!document.querySelector('.voice-messages .bot-typing[role="status"]')`);
 const voice=await tab.ev(`({voice:document.querySelectorAll('.voice-messages .bot-typing[role="status"]').length,composer:document.querySelectorAll('.composer-chrome .bot-typing').length,total:document.querySelectorAll('.bot-typing').length,cards:document.querySelectorAll('.bot-image-activity').length,overflowX:document.querySelector('.voice-messages').scrollWidth>document.querySelector('.voice-messages').clientWidth,bodyWidth:document.documentElement.scrollWidth,viewport:innerWidth})`);
 metrics.push({label:'voice',...voice});
 ok(voice.voice===1&&voice.composer===0&&voice.total===1,'voice typing stays in its own chat column, once');
 ok(voice.cards===0,'no image card is injected into the voice transcript');
 ok(!voice.overflowX&&voice.bodyWidth<=voice.viewport+1,'voice layout stays inside the window');
 await shot('voice-typing');
 await setTyping([]);await sleep(2400);

 // 9. Narrow window: the card and the dock stay inside the chat column.
 await clickSelector('.server-rail button[title="Личные сообщения"]');
 await tab.wait(`!!document.querySelector('.dialog-list button')`);
 await openRoom('QA Room');
 await tab.wait(`!!document.querySelector('.message-scroll')`);
 await tab.send('Emulation.setDeviceMetricsOverride',{width:720,height:520,deviceScaleFactor:1,mobile:false});
 await sleep(300);
 // A reader at the bottom of the narrow window: the card must follow without a jump.
 await tab.ev(`(()=>{const s=document.querySelector('.message-scroll');s.scrollTop=s.scrollHeight})()`);
 await sleep(250);
 await setTyping([{bot:'bot_sombra',channel:'room_a',until:typingUntil,started_at:Math.floor(Date.now()/1000),activity:'image',status:'Генерирую изображение…'}]);
 await tab.wait(`!!document.querySelector('.bot-image-activity')`);
 await sleep(900);
 const narrow=await cardProbe();
 metrics.push({label:'image card 720x520',...narrow});
 ok(narrow.rect.right<=720&&narrow.rect.left>=0,`card fits the narrow window (${narrow.rect.left.toFixed(1)}..${narrow.rect.right.toFixed(1)})`);
 ok(!narrow.overflowX&&narrow.bodyWidth<=narrow.viewport+1,'narrow transcript has no horizontal overflow');
 ok(narrow.rect.bottom<=narrow.composerTop-4,'narrow card clears the composer');
 ok(narrow.scrollHeight-narrow.scrollTop-narrow.clientHeight<=8,'narrow reader at the bottom follows the card');
 ok(narrow.dockCount===0&&narrow.dotsIndicators===0&&narrow.progressRows===0,'narrow window keeps a single activity signal too');
 await shot('image-card-720');
 await setTyping([]);
 await sleep(2400);
 ok((await tab.ev('qaErrors.length'))===0,'no browser page errors');
}catch(error){
 checks.push(`FAIL ${error.message}`);
 console.error(error);
 process.exitCode=1;
 if(tab){await shot('failure').catch(()=>{});try{console.log('QA_ERRORS '+JSON.stringify(await tab.ev('window.qaErrors||[]')))}catch{}}
}finally{
 for(const socket of socketList)socket.close();
 if(chrome&&chrome.exitCode===null)await new Promise(r=>{chrome.once('exit',r);chrome.kill()});
 if(server)await server.close();
 writeFileSync(`${out}/result.json`,JSON.stringify({passed:checks.length,checks,metrics,output:out},null,2));
 console.log(JSON.stringify({passed:checks.length,output:out,checks},null,2));
}
