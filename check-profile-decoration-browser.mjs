// Real React app (source Vite) with an explicit synthetic API boundary.
// Verifies the profile decorations end to end in the UI: decorated avatars in the transcript (ember ring,
// slime corner pet), the animated cover scene on the profile card and in settings, the settings picker
// (live preview, sequential set_profile_decoration saves, no optimism, errors, remove) and the engine's
// performance rules (one canvas per decorated avatar, at most four animating, polling never recreates a
// canvas, prefers-reduced-motion paints a single static frame). No backend, build, release or native claim.
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {deflateSync} from 'node:zlib';
import net from 'node:net';

const out=`profile-decoration-qa/run-${Date.now()}`,checks=[],metrics=[],sockets=[],requests=[],consoleErrors=[];
mkdirSync(out,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(f,label){let last;for(let i=0;i<300;i++){try{const v=await f();if(v)return v}catch(e){last=e}await sleep(100)}throw Error(`Timeout ${label} ${last?.message||''}`)}
const port=()=>new Promise((r,j)=>{const s=net.createServer();s.once('error',j);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p))})});
function ok(value,label){assert(value,label);checks.push(label);console.log(`PASS ${label}`)}
async function connect(url){
 const ws=new WebSocket(url);sockets.push(ws);
 await new Promise(r=>ws.addEventListener('open',r,{once:true}));
 let id=0;const pending=new Map();
 ws.addEventListener('message',event=>{const message=JSON.parse(event.data);
  if(message.method==='Network.requestWillBeSent')requests.push(message.params.request.url);
  if(message.method==='Runtime.consoleAPICalled'&&message.params.type==='error')consoleErrors.push(message.params.args.map(arg=>arg.value??arg.description??arg.type).join(' '));
  const wait=pending.get(message.id);if(!wait)return;pending.delete(message.id);message.error?wait[1](Error(message.error.message)):wait[0](message.result)});
 const send=(method,params={})=>new Promise((r,j)=>{const n=++id;pending.set(n,[r,j]);ws.send(JSON.stringify({id:n,method,params}))});
 const ev=async expression=>{const value=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(value.exceptionDetails)throw Error(JSON.stringify(value.exceptionDetails.exception?.description??value.exceptionDetails));return value.result.value};
 return {send,ev,wait:expression=>until(()=>ev(expression),expression)};
}
async function shot(name,clip){
 await tab.ev('document.fonts.ready');
 const params={format:'png'};
 if(clip){params.captureBeyondViewport=true;params.clip={...clip,scale:2}}
 const result=await tab.send('Page.captureScreenshot',params);
 writeFileSync(`${out}/${name}.png`,Buffer.from(result.data,'base64'));
 return `${name}.png`;
}
const rect=selector=>tab.ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})()`);
const click=async selector=>{await tab.wait(`!!document.querySelector(${JSON.stringify(selector)})`);const point=await tab.ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})()`);await tab.send('Input.dispatchMouseEvent',{type:'mousePressed',x:point.x+point.width/2,y:point.y+point.height/2,button:'left',clickCount:1});await tab.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x+point.width/2,y:point.y+point.height/2,button:'left',clickCount:1});await sleep(200)};
const escape=async()=>{await tab.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27,nativeVirtualKeyCode:27});await tab.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27,nativeVirtualKeyCode:27});await sleep(250)};

// ---- synthetic cover picture for the "old picture cover is unchanged" case (3x1 PNG, a real decodable image).
const CRC=(()=>{const table=new Int32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;table[n]=c}return table})();
const crc32=buffer=>{let c=0xffffffff;for(const byte of buffer)c=CRC[(c^byte)&255]^(c>>>8);return (c^0xffffffff)>>>0};
const chunk=(type,data)=>{const length=Buffer.alloc(4);length.writeUInt32BE(data.length);const name=Buffer.from(type,'ascii');const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(Buffer.concat([name,data])));return Buffer.concat([length,name,data,crc])};
function png(width,height,pixels){
 const header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
 const stride=width*3,raw=Buffer.alloc(height*(stride+1));
 for(let y=0;y<height;y++)pixels.copy(raw,y*(stride+1)+1,y*stride,(y+1)*stride);
 return Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
const coverBytes=png(3,1,Buffer.from([226,74,96,246,166,58,88,170,240]));
const coverMeta={id:'cover_bob_1',mime:'image/png',width:3,height:1,animated:false,bytes:coverBytes.length,crop:{x:0,y:0,width:100,height:100}};

// ---- synthetic state: one decorated owner, one decorated friend, one undecorated friend with an old picture cover.
const NOW=Math.floor(Date.now()/1000);
const emberDoc={v:1,target:'avatar',seed:19,layers:[{effect:'holy/divine-shield',palette:'ember',anchor:'ring',intensity:0.9}]};
const slimeDoc={v:1,target:'avatar',seed:7,layers:[{effect:'critters/slime',palette:'poison',anchor:'bottom-right',intensity:0.85}]};
const sceneDoc={v:1,target:'cover',mode:'scene',loop:true,seed:11,layers:[{effect:'weather/aurora',palette:'aurora',anchor:'fill',intensity:0.75},{effect:'sombra/runner',palette:'ice',anchor:'runner',intensity:0.9}]};
const me={id:'owner_qa',name:'QA Owner',bio:'Владелец синтетической проверки',online:true,created_at:1,coverSupported:true,decorationSupported:true,decorations:{avatar:emberDoc,cover:sceneDoc}};
const alice={id:'alice_member',name:'Alice Member',bio:'Подруга с питомцем',online:true,created_at:1,decorationSupported:true,decorations:{avatar:slimeDoc}};
const bob={id:'bob_plain',name:'Боб Без Украшений',bio:'Обычная обложка-картинка',online:false,created_at:1,coverSupported:true,decorationSupported:true,cover:coverMeta};
const state={
 me,email:'qa@local.test',users:[me,alice,bob],
 groups:[],
 dialogs:[{id:'room_a',name:'Alice Member',members:[me.id,alice.id]},{id:'room_b',name:'Боб Без Украшений',members:[me.id,bob.id]}],
 messages:[
  {id:'a1',channel:'room_a',user:alice.id,text:'Привет! Смотри, у меня теперь слайм в углу аватара.',time:NOW-900},
  {id:'a2',channel:'room_a',user:me.id,text:'А у меня огненная рамка — и сцена на обложке профиля.',time:NOW-860},
  {id:'a3',channel:'room_a',user:alice.id,text:'Пиксельные эффекты рисуются на устройстве, без картинок из сети.',time:NOW-820},
  {id:'a4',channel:'room_a',user:me.id,text:'Проверим, что список сообщений не создаёт лишние холсты.',time:NOW-780},
  {id:'b1',channel:'room_b',user:bob.id,text:'У меня старая обложка-картинка и обычный аватар.',time:NOW-700},
  {id:'b2',channel:'room_b',user:me.id,text:'Её не трогаем: сцена показывается только при украшении обложки.',time:NOW-660},
 ],
 stickers:[],friends:[],bots:[],dialogCalls:[],voicePresence:{},
 chatPreferences:{revision:1,notifications:{direct:true,groups:true},dialogs:{}},
 decorationSupported:true,conversationMemberSearchSupported:false,dialogMetadataSupported:true,
 humanTypingSupported:true,humanTyping:[],readReceiptsSupported:true,botTyping:[],
};
const asciiJson=value=>JSON.stringify(value).replace(/[\u0080-\uffff]/g,character=>`\\u${character.charCodeAt(0).toString(16).padStart(4,'0')}`);
const coverBase64=coverBytes.toString('base64');
const init=`window.qaState=${asciiJson(state)};window.qaErrors=[];window.qaCalls=[];window.qaSaveDelay=0;window.qaFailDecoration=false;window.__fxPaints=[];
window.qaCover=${asciiJson({...coverMeta,user:bob.id,data:coverBase64})};
const respond=(payload,status=200)=>new Response(JSON.stringify(payload),{status,headers:{'content-type':'application/json'}});
function setMe(mutate){const row=qaState.users.find(user=>user.id==='owner_qa')||qaState.me;mutate(row);qaState.me=row}
window.fetch=async(url,opts={})=>{
 if(!String(url).startsWith('/api'))throw Error('Unexpected fetch '+url);
 const body=JSON.parse(opts.body||'{}');
 if(body.op==='me')return respond({data:structuredClone(qaState.me)});
 if(body.op==='state')return respond({data:structuredClone(qaState)});
 if(body.op==='sessions')return respond({data:[]});
 if(body.op==='profile_cover')return respond({data:structuredClone(qaCover)});
 if(body.op==='set_profile_decoration'){
  if(qaSaveDelay)await new Promise(done=>setTimeout(done,qaSaveDelay));
  qaCalls.push({op:body.op,target:body.target,decoration:body.decoration});
  if(qaFailDecoration)return respond({error:'PROFILE_DECORATION_INVALID'},200);
  setMe(user=>{
   if(body.decoration===null||body.decoration===undefined){if(user.decorations){delete user.decorations[body.target];if(!Object.keys(user.decorations).length)delete user.decorations}}
   else{user.decorations=user.decorations||{};user.decorations[body.target]=body.decoration}
  });
  return respond({data:{user:structuredClone(qaState.me)}});
 }
 return respond({data:{}});
};
const originalPutImageData=CanvasRenderingContext2D.prototype.putImageData;
CanvasRenderingContext2D.prototype.putImageData=function(...args){
 try{const canvas=this.canvas;const log=window.__fxPaints;log.push({t:performance.now(),effect:(canvas&&canvas.dataset&&canvas.dataset.avatarFxEffect)||'?'});if(log.length>4000)log.splice(0,log.length-4000)}catch{}
 return originalPutImageData.apply(this,args);
};
addEventListener('error',event=>qaErrors.push(String(event.message||event.error)));
addEventListener('unhandledrejection',event=>qaErrors.push(String(event.reason)));
`;

const focusPicker=async()=>{await tab.ev(`document.querySelector('.decoration-picker')?.scrollIntoView({block:'center'})`);await sleep(250)};
let server,chrome,tab;
try{
 const webPort=await port(),debugPort=await port();
 server=await createServer({plugins:[{name:'synthetic-decoration-fixture',transformIndexHtml(){return[{tag:'script',children:init,injectTo:'head-prepend'}]}}],server:{host:'127.0.0.1',port:webPort,strictPort:true,watch:{ignored:['**/*-qa/**','**/target/**','**/data/**','**/dist/**']}}});
 await server.listen();
 const origin=`http://127.0.0.1:${webPort}`;
 chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-sandbox','--disable-gpu','--mute-audio','--no-first-run','--hide-scrollbars','--remote-debugging-port='+debugPort,'--user-data-dir='+process.cwd()+'/'+out+'/browser','about:blank'],{stdio:'ignore',windowsHide:true});
 const pages=await until(async()=>{const list=await(await fetch(`http://127.0.0.1:${debugPort}/json`)).json();return list.length&&list},'CDP');
 tab=await connect(pages.find(page=>page.type==='page').webSocketDebuggerUrl);
 await tab.send('Page.enable');await tab.send('Network.enable');
 // The host OS setting must not decide the result: motion on for the animation checks, off at the end.
 await tab.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
 await tab.send('Emulation.setDeviceMetricsOverride',{width:1280,height:860,deviceScaleFactor:1,mobile:false});
 await tab.send('Page.navigate',{url:`${origin}/#chat`});
 await tab.wait(`!!document.querySelector('.profile-name strong')`);
 await tab.wait(`document.querySelectorAll('.dialog-list .dialog-row').length===2`);
 await click('.dialog-list [data-dialog-id="room_a"]');
 await tab.wait(`document.querySelectorAll('.message-scroll article[data-message-id]').length>=4`);
 await sleep(400);

 // ---- 1. Transcript: every decorated human avatar gets its own canvas; undecorated rows get none.
 const transcript=await tab.ev(`(()=>{
  const rows=[...document.querySelectorAll('.message-scroll article[data-message-id]')];
  const row=id=>rows.find(row=>row.dataset.messageId===id);
  const describe=el=>{const canvas=el?.querySelector('.avatar-fx__canvas');return canvas?{effect:canvas.dataset.avatarFxEffect,anchor:canvas.dataset.avatarFxAnchor,grid:[canvas.width,canvas.height],css:canvas.getBoundingClientRect().width}:null};
  return{rows:rows.length,alice:describe(row('a1')?.querySelector('.message-avatar')),mine:describe(row('a2')?.querySelector('.message-avatar')),frames:document.querySelectorAll('.message-scroll .avatar-fx').length};
 })()`);
 metrics.push({label:'transcript',...transcript});
 ok(transcript.mine?.effect==='holy/divine-shield','the owner message avatar wears the ember ring',`${transcript.mine?.effect} ${transcript.mine?.anchor}`);
 ok(transcript.mine?.anchor==='ring','the ring anchor is used for the avatar frame');
 ok(transcript.alice?.effect==='critters/slime','the friend message avatar has the slime pet',`${transcript.alice?.effect} ${transcript.alice?.anchor}`);
 ok(transcript.alice?.anchor==='bottom-right','the slime sits in the bottom-right corner');
 await tab.wait(`document.querySelectorAll('.message-scroll .avatar-fx__canvas').length>0`);

 const painted=await tab.ev(`(()=>{
  const count=canvas=>{const ctx=canvas.getContext('2d');const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;let r=0,g=0,b=0;for(let i=0;i<data.length;i+=4){if(data[i+3]<20)continue;r++;g+=data[i];b+=data[i+2]}return{lit:r,meanR:r?Math.round(g/r):0,meanB:r?Math.round(b/r):0}};
  const ring=[...document.querySelectorAll('.message-scroll .avatar-fx__canvas')].find(c=>c.dataset.avatarFxEffect==='holy/divine-shield');
  const slime=[...document.querySelectorAll('.message-scroll .avatar-fx__canvas')].find(c=>c.dataset.avatarFxEffect==='critters/slime');
  return{ring:ring?count(ring):null,slime:slime?count(slime):null};
 })()`);
 metrics.push({label:'painted',...painted});
 ok(painted.ring?.lit>20,'the ember ring canvas actually draws pixels',`${painted.ring?.lit} lit`);
 ok(painted.ring?.meanR>painted.ring?.meanB,'the ring is warm ember, not a grey outline',`r ${painted.ring?.meanR} b ${painted.ring?.meanB}`);
 ok(painted.slime?.lit>20,'the slime canvas actually draws pixels',`${painted.slime?.lit} lit`);

 const ringRect=await rect('.message-scroll article[data-message-id="a2"] .message-avatar');
 const slimeRect=await rect('.message-scroll article[data-message-id="a1"] .message-avatar');
 await shot('messages-ember-ring',{x:ringRect.x-14,y:ringRect.y-14,width:ringRect.width+28,height:ringRect.height+28});
 await shot('messages-slime',{x:slimeRect.x-14,y:slimeRect.y-14,width:slimeRect.width+28,height:slimeRect.height+28});
 await shot('transcript',null);

 // ---- 2. Polling must not recreate the decoration canvases.
 await tab.ev(`document.querySelector('.message-scroll .avatar-fx__canvas').__qaMark='keep'`);
 await sleep(2600);
 const stable=await tab.ev(`({marked:[...document.querySelectorAll('.avatar-fx__canvas')].filter(c=>c.__qaMark==='keep').length,state:qaState.me.decorations.avatar.layers[0].effect})`);
 ok(stable.marked===1,'a 2 s state poll keeps the same canvas element (no re-instancing)');

 // ---- 3. Scheduler budget in the settled transcript.
 await sleep(1200);
 await tab.ev('window.__fxPaints.length=0');
 await sleep(1000);
 const budget=await tab.ev(`(()=>{const log=window.__fxPaints;let max=0;const effects=new Set();
  for(let i=0;i<log.length;i++){let count=0;const seen=new Set();for(let j=i;j<log.length&&log[j].t-log[i].t<=34;j++){if(seen.has(log[j].effect))continue;seen.add(log[j].effect);count++}max=Math.max(max,count)}
  for(const entry of log)effects.add(entry.effect);
  return{max,paints:log.length,effects:[...effects]}})()`);
 metrics.push({label:'scheduler',...budget});
 ok(budget.paints>=20,`the shared loop keeps painting visible decorations (${budget.paints} paints/s)`);
 ok(budget.max<=4,'never more than four canvases animate at once',`${budget.max} in one frame`);
 ok(budget.effects.includes('critters/slime')&&budget.effects.includes('holy/divine-shield'),'both effects are alive in the transcript');

 // ---- 4. Cover scene on the profile card + ring on the xl avatar.
 await click('.profile-self');
 await tab.wait(`!!document.querySelector('.user-profile')`);
 await tab.wait(`!!document.querySelector('.user-profile-banner .avatar-fx--scene canvas')`);
 await sleep(500);
 const card=await tab.ev(`(()=>{const scene=document.querySelector('.user-profile-banner .avatar-fx--scene canvas');const banner=document.querySelector('.user-profile-banner').getBoundingClientRect();
  return{scene:!!scene,grid:scene?[scene.width,scene.height]:null,width:scene?scene.getBoundingClientRect().width:0,bannerWidth:banner.width,img:!!document.querySelector('.user-profile-banner img'),
   ring:!!document.querySelector('.user-profile-identity .avatar-fx__canvas[data-avatar-fx-effect="holy/divine-shield"]')}})()`);
 metrics.push({label:'profile card',...card});
 ok(card.scene,'the profile banner is the animated pixel scene');
 ok(card.grid?.[0]===320&&card.grid?.[1]===107,'the scene renders its own 320x107 pixel grid',`${card.grid}`);
 ok(Math.abs(card.width-card.bannerWidth)<2,'the scene fills the banner',`${card.width}/${card.bannerWidth}`);
 ok(card.img===false,'no picture is put under the opaque scene');
 ok(card.ring,'the xl profile avatar keeps its decorated frame');
 await shot('profile-card-cover-scene',null);
 await escape();
 await tab.wait(`!document.querySelector('.user-profile')`);

 // ---- 5. An old picture cover without a cover decoration stays exactly a picture.
 await click('.dialog-list [data-dialog-id="room_b"]');
 await tab.wait(`!!document.querySelector('article[data-message-id="b1"]')`);
 await click('.chat-conversation-info');
 await tab.wait(`!!document.querySelector('.user-profile')`);
 await tab.wait(`!!document.querySelector('.user-profile-banner img')`);
 await sleep(400);
 const oldCover=await tab.ev(`(()=>{const banner=document.querySelector('.user-profile-banner');const img=banner.querySelector('img');return{img:!!img,ready:img?img.complete&&img.naturalWidth>0:false,scene:!!banner.querySelector('.avatar-fx--scene'),frame:!!banner.querySelector('.avatar-fx'),decoratedAvatar:!!document.querySelector('.user-profile-identity .avatar-fx')}})()`);
 metrics.push({label:'old cover',...oldCover});
 ok(oldCover.img&&oldCover.ready,'a picture cover without decorations still loads and shows');
 ok(oldCover.scene===false&&oldCover.frame===false,'no scene or overlay is drawn on a picture cover');
 ok(oldCover.decoratedAvatar===false,'an undecorated user keeps the plain avatar');
 await shot('profile-old-picture-cover',null);
 await escape();
 await tab.wait(`!document.querySelector('.user-profile')`);

 // ---- 6. Settings: cover preview, picker live preview and saved state.
 await click('.profile > button[title="Настройки пользователя"]');
 await tab.wait(`!!document.querySelector('#decoration-heading')`);
 await sleep(500);
 const picker=await tab.ev(`(()=>{
  const section=document.querySelector('.decoration-picker');
  const radios=selector=>[...document.querySelectorAll(selector)].map(input=>({value:input.value,checked:input.checked,disabled:input.disabled}));
  const preview=section.querySelector('[data-decoration-preview="avatar"] .avatar-fx__canvas');
  const coverPreview=section.querySelector('[data-decoration-preview="cover"] .avatar-fx--scene canvas');
  const buttons=[...section.querySelectorAll('.decoration-actions button')].map(button=>({text:button.textContent.trim(),disabled:button.disabled}));
  return{section:!!section,heading:document.querySelector('#decoration-heading').textContent.trim(),
   avatarRadios:radios('input[name="sombra-avatar-decoration"]'),coverRadios:radios('input[name="sombra-cover-decoration"]'),
   previewEffect:preview?preview.dataset.avatarFxEffect:null,previewCover:!!coverPreview,buttons,
   coverSettings:!!document.querySelector('.settings-cover-preview .avatar-fx--scene canvas'),
   avatarInput:!!document.querySelector('#account-avatar')&&!document.querySelector('#account-avatar').disabled,
   coverInput:!!document.querySelector('#account-cover')&&!document.querySelector('#account-cover').disabled,
   options:section.querySelectorAll('.decoration-option').length};
 })()`);
 metrics.push({label:'picker',...picker});
 ok(picker.section,'the settings page renders the «Украшение профиля» section');
 ok(picker.options===6,'six options: no frame / ember / slime and no scene / runner / aurora',`${picker.options}`);
 ok(picker.avatarRadios.find(option=>option.value==='ember')?.checked,'the saved ember frame is preselected');
 ok(picker.coverRadios.find(option=>option.value==='runner')?.checked,'the saved cover scene is preselected');
 ok(picker.previewEffect==='holy/divine-shield','the live avatar preview draws the selected frame');
 ok(picker.previewCover,'the live cover preview draws the selected scene');
 ok(picker.coverSettings,'the existing cover field shows the scene too');
 ok(picker.avatarInput&&picker.coverInput,'the old avatar and cover inputs keep working next to the picker');
 ok(picker.buttons.some(button=>button.disabled&&/Сохранить/.test(button.text)),'save is disabled while nothing is changed');
 await focusPicker();
 await shot('picker-default',null);
 // The same section in the minimum window: one option per row, no horizontal overflow.
 await tab.send('Emulation.setDeviceMetricsOverride',{width:720,height:520,deviceScaleFactor:1,mobile:false});
 await sleep(350);
 await focusPicker();
 const narrow=await tab.ev(`(()=>{const section=document.querySelector('.decoration-picker');const panel=document.querySelector('#account-panel');const group=section.querySelector('.decoration-options');const labels=[...group.querySelectorAll('.decoration-option')];const firstRow=labels.filter(el=>el.offsetTop===labels[0].offsetTop).length;return{sectionOverflow:section.scrollWidth-section.clientWidth,panelOverflow:panel.scrollWidth-panel.clientWidth,firstRow,previewWidths:[...section.querySelectorAll('.decoration-preview-avatar,.decoration-preview-cover')].map(el=>Math.round(el.getBoundingClientRect().width))}})()`);
 metrics.push({label:'narrow picker',...narrow});
 ok(narrow.sectionOverflow<=1&&narrow.panelOverflow<=1,'the picker fits a narrow settings window without horizontal overflow',`${narrow.sectionOverflow}/${narrow.panelOverflow}`);
 ok(narrow.firstRow===1,'the option cards stack in one column on a narrow window',`${narrow.firstRow} per row`);
 await shot('picker-narrow',null);
 await tab.send('Emulation.setDeviceMetricsOverride',{width:1280,height:860,deviceScaleFactor:1,mobile:false});
 await sleep(350);

 // ---- 7. Save: sequential call, no optimism, buttons locked while the request is in flight.
 await tab.ev(`document.querySelector('input[name="sombra-avatar-decoration"][value="slime"]').click()`);
 await sleep(250);
 const draft=await tab.ev(`(()=>{const canvas=document.querySelector('[data-decoration-preview="avatar"] .avatar-fx__canvas');return{effect:canvas?canvas.dataset.avatarFxEffect:null,saved:qaState.me.decorations.avatar.layers[0].effect,saveDisabled:[...document.querySelectorAll('.decoration-actions button')][0].disabled}})()`);
 ok(draft.effect==='critters/slime','the live preview switches to the slime immediately');
 ok(draft.saved==='holy/divine-shield','the draft is not sent before pressing save');
 ok(draft.saveDisabled===false,'save becomes available after a change');
 await tab.ev('window.qaSaveDelay=700');
 await click('.decoration-actions button');
 const inflight=await tab.ev(`(()=>{const buttons=[...document.querySelectorAll('.decoration-actions button')];return{disabled:buttons.every(button=>button.disabled),label:buttons[0].textContent.trim(),saved:qaState.me.decorations.avatar.layers[0].effect}})()`);
 ok(inflight.disabled,'both buttons are disabled while the request is in flight');
 ok(/Сохраняем/.test(inflight.label),`the save button reports progress (${inflight.label})`);
 ok(inflight.saved==='holy/divine-shield','nothing is applied optimistically while the server works');
 await until(async()=>await tab.ev(`qaCalls.some(call=>call.target==='avatar')`),'avatar save call');
 await until(async()=>await tab.ev(`(()=>{const buttons=[...document.querySelectorAll('.decoration-actions button')];return buttons.length===2&&buttons[0].disabled&&!/Сохраняем/.test(buttons[0].textContent)})()`),'saved state applied');
 await sleep(350);
 const saved=await tab.ev(`(()=>{const calls=qaCalls.filter(call=>call.op==='set_profile_decoration');return{calls:calls.map(call=>({target:call.target,effect:call.decoration&&call.decoration.layers?call.decoration.layers[0].effect:null,anchor:call.decoration&&call.decoration.layers?call.decoration.layers[0].anchor:null,mode:call.decoration?call.decoration.mode||null:null})),server:qaState.me.decorations.avatar.layers[0].effect,notice:document.querySelector('.decoration-notice')?.textContent||'',cover:qaState.me.decorations.cover.mode}})()`);
 metrics.push({label:'avatar save',...saved});
 ok(saved.calls.length===1&&saved.calls[0].target==='avatar','only the changed target is sent',JSON.stringify(saved.calls));
 ok(saved.calls[0].effect==='critters/slime'&&saved.calls[0].anchor==='bottom-right','the slime preset is sent to the server');
 ok(saved.server==='critters/slime','the saved state comes back from the server');
 ok(/сохранено/i.test(saved.notice),`success is reported as text (${saved.notice})`);
 ok(saved.cover==='scene','the untouched cover document is not overwritten');
 await tab.ev('window.qaSaveDelay=0');
 await focusPicker();
 await shot('picker-saved-slime',null);

 // ---- 8. Error path: the server rejects, the text is shown, nothing changes.
 await tab.ev(`document.querySelector('input[name="sombra-cover-decoration"][value="aurora"]').click()`);
 await tab.ev('window.qaFailDecoration=true');
 await sleep(150);
 await click('.decoration-actions button');
 await tab.wait(`!!document.querySelector('.decoration-picker [role="alert"]')`);
 const failed=await tab.ev(`(()=>{const alert=document.querySelector('.decoration-picker [role="alert"]');const radios=[...document.querySelectorAll('input[name="sombra-cover-decoration"]')];return{text:alert.textContent||'',serverMode:qaState.me.decorations.cover.mode,checked:(radios.find(input=>input.checked)||{}).value,notice:!!document.querySelector('.decoration-notice')}})()`);
 metrics.push({label:'error path',...failed});
 ok(/PROFILE_DECORATION_INVALID/.test(failed.text),`the server error is shown as text (${failed.text})`);
 ok(failed.serverMode==='scene','a rejected save changes nothing on the server');
 ok(failed.checked==='aurora','the rejected draft stays in the picker instead of being applied');
 ok(failed.notice===false,'no success notice after an error');
 await focusPicker();
 await shot('picker-error',null);
 await tab.ev('window.qaFailDecoration=false');

 // ---- 9. Cover save and «Убрать».
 await tab.ev('window.qaCalls.length=0');
 await tab.ev(`document.querySelector('input[name="sombra-cover-decoration"][value="aurora"]').click()`);
 await click('.decoration-actions button');
 await until(async()=>await tab.ev(`qaCalls.some(call=>call.target==='cover')`),'cover save call');
 await until(async()=>await tab.ev(`(()=>{const buttons=[...document.querySelectorAll('.decoration-actions button')];return buttons.length===2&&buttons[0].disabled&&!/Сохраняем/.test(buttons[0].textContent)})()`),'cover saved state applied');
 await sleep(350);
 const coverSave=await tab.ev(`(()=>{const calls=qaCalls.filter(call=>call.op==='set_profile_decoration');return{calls:calls.map(call=>({target:call.target,effect:call.decoration&&call.decoration.layers?call.decoration.layers[0].effect:null,mode:call.decoration?call.decoration.mode||null:null})),serverEffect:qaState.me.decorations.cover.layers[0].effect,preview:!!document.querySelector('[data-decoration-preview="cover"] .avatar-fx--cover .avatar-fx__canvas')}})()`);
 metrics.push({label:'cover save',...coverSave});
 ok(coverSave.calls.length===1&&coverSave.calls[0].target==='cover','the cover is saved with its own call',JSON.stringify(coverSave.calls));
 ok(coverSave.serverEffect==='weather/aurora'&&coverSave.calls[0].mode===null,'the aurora overlay document is stored (frame mode)');
 ok(coverSave.preview,'the cover preview switches from the scene to the aurora overlay');
 await focusPicker();
 await shot('picker-aurora-cover',null);

 await tab.ev('window.qaCalls.length=0');
 const removeClicked=await tab.ev(`(()=>{const button=[...document.querySelectorAll('.decoration-actions button')].find(item=>item.textContent.trim()==='Убрать');if(!button||button.disabled)return false;button.click();return true})()`);
 ok(removeClicked,'the «Убрать» button is available while decorations exist');
 await until(async()=>await tab.ev(`qaCalls.filter(call=>call.op==='set_profile_decoration').length>=2`),'two remove calls');
 await until(async()=>await tab.ev(`(()=>{const buttons=[...document.querySelectorAll('.decoration-actions button')];const remove=buttons.find(item=>item.textContent.trim()==='Убрать');return !!remove&&remove.disabled&&!/Сохраняем/.test(buttons[0].textContent)})()`),'removed state applied');
 await sleep(350);
 const removed=await tab.ev(`(()=>{const calls=qaCalls.filter(call=>call.op==='set_profile_decoration');const section=document.querySelector('.decoration-picker');return{calls:calls.map(call=>({target:call.target,decoration:call.decoration})),server:qaState.me.decorations||null,radios:[...section.querySelectorAll('input[type="radio"]')].filter(input=>input.checked).map(input=>input.value),previewCanvases:section.querySelectorAll('.decoration-preview .avatar-fx__canvas').length,removeDisabled:[...section.querySelectorAll('.decoration-actions button')].find(item=>item.textContent.trim()==='Убрать').disabled,notice:section.querySelector('.decoration-notice')?.textContent||'',attrs:{...section.dataset},meDecorations:qaState.me.decorations===undefined?'undefined':typeof qaState.me.decorations}})()`);
 metrics.push({label:'remove',...removed});
 ok(removed.calls.length===2&&removed.calls.every(call=>call.decoration===null),'«Убрать» sends null for every saved target',JSON.stringify(removed.calls));
 ok(removed.calls.map(call=>call.target).sort().join(',')==='avatar,cover','avatar and cover are cleared one after another');
 ok(removed.server===null,'the server has no decorations left');
 ok(removed.radios.join(',')==='none,none','both pickers fall back to «Нет»');
 ok(removed.previewCanvases===0,'the previews drop their canvases once nothing is selected');
 ok(removed.removeDisabled===true,'«Убрать» is disabled when there is nothing to remove');
 ok(/убрано/i.test(removed.notice),`removal is reported as text (${removed.notice})`);
 await focusPicker();
 await shot('picker-removed',null);

 // ---- 10. prefers-reduced-motion: one static frame, no animation loop.
 await tab.ev(`qaState.me.decorations={avatar:${asciiJson(emberDoc)},cover:${asciiJson(sceneDoc)}};qaState.users.find(user=>user.id==='owner_qa').decorations=qaState.me.decorations;true`);
 await tab.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
 await tab.send('Page.reload',{ignoreCache:true});
 await tab.wait(`!!document.querySelector('.profile-name strong')`);
 await click('.dialog-list [data-dialog-id="room_a"]');
 await tab.wait(`!!document.querySelector('.message-scroll .avatar-fx__canvas')`);
 await sleep(1500);
 await tab.ev('window.__fxPaints.length=0');
 await sleep(700);
 const reduced=await tab.ev(`(()=>{const canvas=[...document.querySelectorAll('.message-scroll .avatar-fx__canvas')][0];const ctx=canvas.getContext('2d');const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;let lit=0;for(let i=3;i<data.length;i+=4)if(data[i]>20)lit++;
  return{paints:window.__fxPaints.length,lit}})()`);
 metrics.push({label:'reduced motion',...reduced});
 ok(reduced.paints===0,'prefers-reduced-motion never runs the frame loop',`${reduced.paints} paints`);
 ok(reduced.lit>20,'reduced motion still shows a static decoration frame',`${reduced.lit} lit`);
 await shot('reduced-motion-static',null);
 await tab.send('Emulation.setEmulatedMedia',{features:[]});

 // ---- 11. Privacy and errors.
 await tab.ev(`qaState.me.decorations={avatar:${asciiJson(emberDoc)},cover:${asciiJson(sceneDoc)}};true`);
 const external=requests.filter(url=>!url.startsWith(origin)&&!url.startsWith('data:')&&!url.startsWith('blob:'));
 ok(external.length===0,'decorations never fetch anything external',external.slice(0,3).join(', '));
 const pageErrors=await tab.ev('window.qaErrors');
 ok(pageErrors.length===0,'no page errors',pageErrors.join(' | '));
 ok(consoleErrors.length===0,'no console errors',consoleErrors.slice(0,3).join(' | '));
}catch(error){
 checks.push(`FAIL ${error.message}`);
 console.error(error);
 process.exitCode=1;
 if(tab){await shot('failure',null).catch(()=>{});try{console.log('QA_ERRORS '+JSON.stringify(await tab.ev('window.qaErrors||[]')))}catch{}}
}finally{
 for(const socket of sockets)socket.close();
 if(chrome&&chrome.exitCode===null)await new Promise(r=>{chrome.once('exit',r);chrome.kill()});
 if(server)await server.close();
 const result={passed:checks.length,checks,metrics,output:out,limitations:[
  'Real app source (Vite dev server) with a synthetic in-page API; no Rust backend, no persistence',
  'prefers-reduced-motion is emulated through CDP, not a real OS setting',
  'Synthetic 3x1 PNG stands in for a user picture cover; no production or release claims',
 ]};
 writeFileSync(`${out}/result.json`,JSON.stringify(result,null,2));
 console.log(JSON.stringify({passed:checks.length,output:out,checks},null,2));
}
