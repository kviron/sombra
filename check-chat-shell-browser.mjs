// Real React LiveChat (source Vite) with an explicit synthetic API boundary.
// Verifies the Sombra composer dock, the pinned activity row and the full-width
// account panel: measured composer height, transcript clearance, matte surface,
// typing/job state and narrow-window layout. No backend, production or native claim.
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import net from 'node:net';

const out=`chat-shell-qa/run-${Date.now()}`,checks=[],metrics=[],socketList=[];
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
const botUser={id:'bot_sombra',name:'Сомбра',username:'hermes',bot:true,created_at:1};
const state={
 me,email:'qa@local.test',users:[me,alice,botUser],
 groups:[{id:'group_qa',name:'QA Group',owner:me.id,members:[me.id,alice.id],invite:'synthetic',channels:[{id:'text_qa',name:'qa-room',kind:'text'},{id:'voice_qa',name:'voice-room',kind:'voice'}]}],
 dialogs:[{id:'room_a',name:'QA Room',members:[me.id,alice.id,botUser.id]}],
 messages:Array.from({length:14},(_,i)=>({id:`m${i+1}`,channel:'room_a',user:i%3===2?botUser.id:alice.id,text:`Синтетическое сообщение ${i+1}: ${'длинная строка проверки переноса '.repeat(i%3===0?2:1)}`,time:NOW-2000+i*30})),
 stickers:[],friends:[],
 bots:[{...botUser,enabled:true,groups:['group_qa'],commands:[]}],
 dialogCalls:[],voicePresence:{},humanTypingSupported:true,humanTyping:[],readReceiptsSupported:true,
 chatPreferences:{revision:1,notifications:{direct:true,groups:true},dialogs:{}},botTyping:[],
};

const asciiJson=value=>JSON.stringify(value).replace(/[\u0080-\uffff]/g,character=>`\\u${character.charCodeAt(0).toString(16).padStart(4,"0")}`);
const init=`window.qaState=${asciiJson(state)};window.qaErrors=[];window.qaOps=[];
window.fetch=async(url,opts={})=>{if(!String(url).startsWith('/api'))throw Error('Unexpected fetch '+url);const body=JSON.parse(opts.body||'{}');qaOps.push(body.op);let data={};
if(body.op==='me')data=qaState.me;
if(body.op==='state')data=structuredClone(qaState);
if(body.op==='sessions')data=[];
if(body.op==='message'){const message={id:'sent_'+qaOps.length,channel:body.channel,user:qaState.me.id,text:body.text||'',time:Date.now()/1000};qaState.messages.push(message);data=message}
return new Response(JSON.stringify({data}),{status:200,headers:{'content-type':'application/json'}})};
addEventListener('error',event=>qaErrors.push(event.message));
addEventListener('unhandledrejection',event=>qaErrors.push(String(event.reason)));`;

const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
let server,chrome,tab;
async function shot(name){const result=await tab.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${out}/${name}.png`,Buffer.from(result.data,'base64'))}
async function click(selector){
 await tab.wait(`!!document.querySelector(${JSON.stringify(selector)})`);
 const point=await tab.ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
 for(const type of ['mousePressed','mouseReleased'])await tab.send('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount:1});
 await sleep(180);
}
async function typeText(value){
 await tab.ev(`document.querySelector('.sombra-assistant-composer textarea').focus()`);
 await tab.send('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});
 await tab.send('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});
 await tab.send('Input.insertText',{text:value});
 await sleep(320);
}
async function attach(){
 await tab.ev(`(()=>{const data=new DataTransfer();data.items.add(new File([Uint8Array.from(atob(${JSON.stringify(png)}),c=>c.charCodeAt(0))],'screenshot.png',{type:'image/png'}));const input=document.querySelector('.attachment-composer input[type=file]');input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}))})()`);
 await tab.wait(`!!document.querySelector('[data-slot="composer-attachment"][data-state="done"]')`);
 await sleep(220);
}
const measure=()=>tab.ev(`(()=>{
 const scroller=document.querySelector('.message-scroll'),chrome=document.querySelector('.composer-chrome');
 if(!scroller||!chrome)return null;
 const form=chrome.querySelector('form'),messages=[...scroller.querySelectorAll('article[data-message-id]')],chip=document.querySelector('[data-slot="composer-attachment"]');
 const rect=e=>{const r=e.getBoundingClientRect();return{top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height}};
 const style=getComputedStyle(form);
 return {viewport:{width:innerWidth,height:innerHeight},position:getComputedStyle(chrome).position,
  chrome:rect(chrome),form:rect(form),scroller:rect(scroller),last:rect(messages.at(-1)),
  under: messages.some(e=>{const r=e.getBoundingClientRect();const c=chrome.getBoundingClientRect();return r.bottom>c.top+1&&r.top<c.bottom-1}),
  chip:chip?rect(chip):null,scrollTop:scroller.scrollTop,scrollHeight:scroller.scrollHeight,clientHeight:scroller.clientHeight,
  overflowX:scroller.scrollWidth>scroller.clientWidth,
  heightVar:scroller.style.getPropertyValue('--sombra-composer-height'),paddingBottom:parseFloat(getComputedStyle(scroller).paddingBottom),
  background:style.backgroundColor,backdrop:style.backdropFilter||style.webkitBackdropFilter,
  bodyWidth:document.documentElement.scrollWidth};
})()`);

async function assertDock(label,{grew}={}){
 const m=await measure();metrics.push({label,...m});
 ok(m.position==='absolute',`${label}: composer floats over the transcript`);
 const measured=parseFloat(m.heightVar);
 ok(Number.isFinite(measured)&&Math.abs(measured-m.chrome.height)<1,`${label}: measured height ${m.heightVar} equals panel height ${m.chrome.height}`);
 ok(Math.abs(m.paddingBottom-(measured+24))<1,`${label}: transcript padding ${m.paddingBottom}px follows the measured panel`);
 ok(m.last.bottom<=m.chrome.top-8,`${label}: last message clears the panel (${m.last.bottom.toFixed(1)} <= ${(m.chrome.top-8).toFixed(1)})`);
 ok(m.chrome.top>=0&&m.chrome.bottom<=m.viewport.height+1,`${label}: composer fits the window ${m.viewport.width}x${m.viewport.height}`);
 ok(m.overflowX===false,`${label}: transcript has no horizontal overflow`);
 ok(/blur\(/.test(m.backdrop)&&/rgba\([^)]*0?\.\d+\)/.test(m.background),`${label}: matte translucent surface (${m.background}, ${m.backdrop})`);
 ok(m.bodyWidth<=m.viewport.width+1,`${label}: page width bounded`);
 if(grew!==undefined)ok(m.chrome.height>grew+24,`${label}: panel grew with the draft ${grew} -> ${m.chrome.height}`);
 return m;
}

try{
 const webPort=await port(),debugPort=await port();
 server=await createServer({plugins:[{name:'synthetic-chat-shell-fixture',transformIndexHtml(){return[{tag:'meta',attrs:{name:'dsh-design',content:'desktop windows'}},{tag:'script',children:init,injectTo:'head-prepend'}]}}],server:{host:'127.0.0.1',port:webPort,strictPort:true,watch:{ignored:['**/*-qa/**','**/target/**','**/data/**']}}});
 await server.listen();
 chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-sandbox','--disable-gpu','--mute-audio','--no-first-run','--remote-debugging-port='+debugPort,'--user-data-dir='+process.cwd()+'/'+out+'/browser','about:blank'],{stdio:'ignore',windowsHide:true});
 const pages=await until(async()=>{const list=await(await fetch(`http://127.0.0.1:${debugPort}/json`)).json();return list.length&&list},'CDP');
 tab=await connect(pages.find(page=>page.type==='page').webSocketDebuggerUrl);
 await tab.send('Page.enable');
 await tab.send('Emulation.setDeviceMetricsOverride',{width:1080,height:720,deviceScaleFactor:1,mobile:false});
 await tab.send('Page.navigate',{url:`http://127.0.0.1:${webPort}/#chat`});
 await tab.wait(`!!document.querySelector('.profile-name strong')`);
 await tab.wait(`!!document.querySelector('.dialog-list button')`);
 await click('.dialog-list button');
 await tab.wait(`!!document.querySelector('article[data-message-id]')`);
 await sleep(400);

 // 1. Composer dock: matte panel, measured height, transcript clearance.
 await tab.send('Emulation.setDeviceMetricsOverride',{width:1080,height:720,deviceScaleFactor:1,mobile:false});
 await sleep(300);
 const empty=await assertDock('empty 1080x720');
 await shot('composer-empty-1080');
 await typeText('Короткая строка');
 await assertDock('one line 1080x720');
 await typeText('Строка один\nСтрока два\nСтрока три\nСтрока четыре\nСтрока пять');
 const five=await assertDock('five lines 1080x720',{grew:empty.chrome.height});
 await shot('composer-five-lines-1080');
 await attach();
 const chip=await assertDock('attachment chip 1080x720');
 ok(chip.chip&&chip.chip.height>=30&&chip.chip.height<=60,`attachment chip is compact (${chip.chip?.height}px)`);
 await shot('composer-chip-1080');
 await tab.ev(`(()=>{const s=document.querySelector('.message-scroll');s.scrollTop=Math.max(0,s.scrollTop-240)})()`);
 await sleep(400);
 const scrolled=await tab.ev(`(()=>{const s=document.querySelector('.message-scroll');const c=document.querySelector('.composer-chrome').getBoundingClientRect();const rows=[...document.querySelectorAll('article[data-message-id]')];return{under:rows.filter(e=>{const r=e.getBoundingClientRect();return r.bottom>c.top+1&&r.top<c.bottom-1}).length,scrollTop:s.scrollTop,atBottom:s.scrollHeight-s.scrollTop-s.clientHeight<=8}})()`);
 ok(scrolled.under>0&&!scrolled.atBottom,`messages stay visible under the frosted panel while scrolling up (${scrolled.under} rows)`);
 await shot('composer-scrolled-up-1080');
 await tab.ev(`document.querySelector('.message-scroll').scrollTop=document.querySelector('.message-scroll').scrollHeight`);
 await sleep(200);

 // 2. Same at the minimum window.
 await tab.send('Emulation.setDeviceMetricsOverride',{width:720,height:520,deviceScaleFactor:1,mobile:false});
 await sleep(350);
 await assertDock('five lines 720x520');
 await shot('composer-min-window-720');
 await tab.ev(`(()=>{const input=document.querySelector('.attachment-composer input[type=file]');const data=new DataTransfer();data.items.add(new File(['synthetic'],'synthetic-'+Date.now()+'.txt',{type:'text/plain'}));input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}))})()`);
 await tab.wait(`!!document.querySelector('[data-slot="composer-attachment"][data-state="done"]')`);
 await sleep(250);
 await assertDock('attachment chip 720x520');

 // 3. The account panel spans the rail and the channel sidebar, pinned to the bottom.
 const layout=await tab.ev(`(()=>{const rect=e=>{const r=e.getBoundingClientRect();return{top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height}};
  const list=document.querySelector('.channel-list'),rail=document.querySelector('.server-rail'),rows=[...document.querySelectorAll('.dialog-row,.channel-row,.channel')];
  return{profile:rect(document.querySelector('.profile')),rail:rect(rail),aside:rect(document.querySelector('.channel-sidebar')),list:rect(list),
   listPad:parseFloat(getComputedStyle(list).paddingBottom),railPad:parseFloat(getComputedStyle(rail).paddingBottom),
   lastRow:rows.length?rect(rows.at(-1)):null,lastServer:rect(rail.querySelector('button:last-of-type')),viewport:{width:innerWidth,height:innerHeight}}})()`);
 metrics.push({label:'sidebar panel',...layout});
 ok(Math.abs(layout.profile.left-layout.rail.left)<1,`account panel starts at the server rail (${layout.profile.left})`);
 ok(Math.abs(layout.profile.right-layout.aside.right)<1,`account panel ends with the channel sidebar (${layout.profile.right})`);
 ok(Math.abs(layout.profile.bottom-layout.viewport.height)<1,'account panel is pinned to the window bottom');
 ok(Math.abs(layout.profile.width-(layout.aside.right-layout.rail.left))<1,`account panel spans rail + sidebar (${layout.profile.width.toFixed(1)}px)`);
 ok(layout.listPad>=58&&layout.lastRow&&layout.lastRow.bottom<=layout.profile.top+0.5,'channel list reserves the panel height');
 ok(layout.railPad>=58&&layout.lastServer.bottom<=layout.profile.top+0.5,'server rail reserves the panel height');
 await shot('sidebar-panel-720');

 // 3b. The column resizer keeps working and the panel follows the new width.
 const resized=await tab.ev(`(async()=>{const handle=document.querySelector('.channel-sidebar>.column-resizer'),aside=document.querySelector('.channel-sidebar');
  handle.focus();const before=aside.getBoundingClientRect().width;
  for(const key of ['ArrowRight','ArrowRight','ArrowRight'])handle.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));
  await new Promise(r=>setTimeout(r,120));
  const profile=document.querySelector('.profile').getBoundingClientRect(),rail=document.querySelector('.server-rail').getBoundingClientRect(),asideBox=aside.getBoundingClientRect();
  const after=aside.getBoundingClientRect().width;
  for(const key of ['ArrowLeft','ArrowLeft','ArrowLeft'])handle.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));
  await new Promise(r=>setTimeout(r,120));
  return{before,after,left:profile.left-rail.left,right:profile.right-asideBox.right}})()`);
 ok(resized.after>resized.before+20,`column resizer still widens the sidebar (${resized.before} -> ${resized.after})`);
 ok(Math.abs(resized.left)<1&&Math.abs(resized.right)<1,'account panel follows the resized sidebar');

 // 4. Activity row: typing indicator + avatar + job line, one stable copy.
 await tab.send('Emulation.setDeviceMetricsOverride',{width:1080,height:720,deviceScaleFactor:1,mobile:false});
 await sleep(300);
 const typingUntil=Math.floor(Date.now()/1000)+90;
 await tab.ev(`qaState.botTyping=[{bot:'bot_sombra',channel:'room_a',until:${typingUntil},stage:'собирает контекст',activity:'Собираю контекст переписки и готовлю ответ'}]`);
 await tab.wait(`!!document.querySelector('.composer-chrome .bot-typing[role="status"]')`);
 await sleep(1300);
 const typing=await tab.ev(`(()=>{const row=document.querySelector('.composer-chrome .bot-typing');const chrome=document.querySelector('.composer-chrome');const job=row.querySelector('[data-slot="job-progress"]');return{count:document.querySelectorAll('.bot-typing').length,role:row.getAttribute('role'),live:row.getAttribute('aria-live'),text:row.innerText,time:row.querySelector('time')?.textContent||'',avatar:!!row.querySelector('.user-avatar'),dots:!!row.querySelector('[data-slot="typing-indicator"]'),expand:!!row.querySelector('[aria-label="Подробности задачи"]'),jobBg:job?getComputedStyle(job).backgroundColor:null,rowTop:row.getBoundingClientRect().top,chromeTop:chrome.getBoundingClientRect().top}})()`);
 metrics.push({label:'typing row',...typing});
 ok(typing.count===1,'exactly one activity row');
 ok(typing.role==='status'&&typing.live==='polite','activity row is a polite status region');
 ok(typing.avatar,'bot avatar is shown on the left of the indicator');
 ok(typing.dots,'official Elements TypingIndicator is rendered');
 ok(/Сомбра/.test(typing.text)&&/собирает контекст/.test(typing.text),`bot name and reported stage are shown (${typing.text.replace(/\n/g,' | ')})`);
 ok(/\d/.test(typing.time),`elapsed time ticks (${typing.time})`);
 ok(typing.expand,'reported activity is expandable');
 await shot('activity-row-1080');
 await click('[aria-label="Подробности задачи"]');
 await tab.wait(`!!document.querySelector('.composer-chrome .bot-typing [aria-expanded="true"]')`);
 const expanded=await tab.ev(`(()=>{const row=document.querySelector('.bot-typing');return{open:row.querySelector('[aria-expanded="true"]')?.getAttribute('aria-expanded'),detail:row.querySelector('[data-slot="job-progress"] p')?.textContent||'',text:row.innerText}})()`);
 ok(expanded.detail.includes('Собираю контекст'),'expand shows the reported activity text');
 ok(!/процент|%|прогресс/i.test(expanded.text),'no invented percentage or reasoning is shown');
 // Foreign traffic must not move or duplicate the row.
 await tab.ev(`(()=>{const before=document.querySelector('.bot-typing').getBoundingClientRect().top;qaState.messages.push({id:'foreign_1',channel:'room_a',user:'alice_member',text:'Новое сообщение от другого участника',time:Date.now()/1000});window.qaBefore=before})()`);
 await sleep(2600);
 const afterForeign=await tab.ev(`(()=>{const row=document.querySelector('.composer-chrome .bot-typing');return{count:document.querySelectorAll('.bot-typing').length,same:!!row&&Math.abs(row.getBoundingClientRect().top-window.qaBefore)<1}})()`);
 ok(afterForeign.count===1&&afterForeign.same,'foreign messages keep the indicator in its place without duplicates');
 // Neutral fallback when the worker reports no stage.
 await tab.ev(`qaState.botTyping=[{bot:'bot_sombra',channel:'room_a',until:${typingUntil}}]`);
 await sleep(2400);
 const neutral=await tab.ev(`(()=>{const row=document.querySelector('.bot-typing');return{text:row?.innerText||'',expand:!!row?.querySelector('[aria-label="Подробности задачи"]')}})()`);
 ok(/работает/.test(neutral.text),`neutral status when no stage is reported (${neutral.text.replace(/\n/g,' | ')})`);
 ok(!neutral.expand,'no dead expand control without a reported detail');
 // Expiry hides the row.
 await tab.ev(`qaState.botTyping=[]`);
 await sleep(2400);
 ok(!(await tab.ev(`!!document.querySelector('.bot-typing')`)),'activity row disappears when typing ends');
 // 5. Voice channel keeps the indicator inside its own chat column.
 await click('.server-rail button[title="QA Group"]');
 await tab.ev(`[...document.querySelectorAll('.channel-list .channel')].find(e=>e.textContent.includes('voice-room')).click()`);
 await tab.wait(`!!document.querySelector('.voice-messages')`);
 await sleep(250);
 const voice=await tab.ev(`(()=>{const chrome=document.querySelector('.composer-chrome');return{position:getComputedStyle(chrome).position,overflowX:document.querySelector('.voice-messages').scrollWidth>document.querySelector('.voice-messages').clientWidth,bodyWidth:document.documentElement.scrollWidth,viewport:innerWidth}})()`);
 ok(voice.position!=='absolute','voice layout keeps the composer in the grid flow');
 ok(voice.overflowX===false&&voice.bodyWidth<=voice.viewport+1,'voice layout stays inside the window');
 await tab.ev(`qaState.botTyping=[{bot:'bot_sombra',channel:'voice_qa',until:${typingUntil}}]`);
 await tab.wait(`!!document.querySelector('.voice-messages .bot-typing[role="status"]')`);
 const voiceTyping=await tab.ev(`({voice:document.querySelectorAll('.voice-messages .bot-typing[role="status"]').length,composer:document.querySelectorAll('.composer-chrome .bot-typing').length,total:document.querySelectorAll('.bot-typing').length})`);
 ok(voiceTyping.voice===1&&voiceTyping.composer===0&&voiceTyping.total===1,'voice typing stays in its own chat column, once');
 await shot('voice-layout');
 await tab.ev(`qaState.botTyping=[]`);
 ok((await tab.ev('qaErrors.length'))===0,'no browser errors');
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
