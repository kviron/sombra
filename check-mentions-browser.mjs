// Real source Vite React LiveChat + installed assistant-ui primitives. Synthetic API boundary.
// No production, native OS notification, real accounts or private data claim.
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync,appendFileSync} from 'node:fs';
import net from 'node:net';
const out=`mentions-qa/run-${Date.now()}`,checks=[],errors=[],sockets=[];mkdirSync(out,{recursive:true});let server,chrome,tab;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(f,label){let last;for(let i=0;i<200;i++){try{const v=await f();if(v)return v}catch(e){last=e}await sleep(150)}throw Error('Timeout '+label+' '+(last?.message||''))}
const port=()=>new Promise((r,j)=>{const s=net.createServer();s.once('error',j);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p))})});
async function connect(url){const ws=new WebSocket(url);sockets.push(ws);await new Promise(r=>ws.addEventListener('open',r,{once:true}));let id=0;const pending=new Map();ws.addEventListener('message',e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p[1](Error(m.error.message)):p[0](m.result)}});const send=(method,params={})=>new Promise((r,j)=>{const n=++id;pending.set(n,[r,j]);ws.send(JSON.stringify({id:n,method,params}))});const ev=async expression=>{const v=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(v.exceptionDetails)throw Error(JSON.stringify(v.exceptionDetails));return v.result.value};return{send,ev,wait:e=>until(()=>ev(e),e)}}
function ok(v,label){assert(v,label);checks.push(label);appendFileSync(out+'/progress.log',label+'\n');console.log('PASS '+label)}
const q=s=>`document.querySelector(${JSON.stringify(s)})`,textarea='.sombra-assistant-composer textarea',mentions='[data-slot="mention-menu-content"]';
async function click(selector){await tab.wait(`!!${q(selector)}`);const p=await tab.ev(`(()=>{const e=${q(selector)};e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);for(const type of ['mousePressed','mouseReleased'])await tab.send('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1});await sleep(200)}
async function key(k){await tab.send('Input.dispatchKeyEvent',{type:'keyDown',key:k,code:k,windowsVirtualKeyCode:k==='Enter'?13:0});await tab.send('Input.dispatchKeyEvent',{type:'keyUp',key:k,code:k,windowsVirtualKeyCode:k==='Enter'?13:0});await sleep(150)}
async function type(value){await tab.send('Input.insertText',{text:value});await sleep(200)}
async function text(value){await click(textarea);await tab.send('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});await tab.send('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});await type(value)}
const value=()=>tab.ev(`${q(textarea)}.value`);
const lastMessage=()=>tab.ev('qaSent.at(-1)||null');
const sentCount=()=>tab.ev('qaSent.length');
const shot=async name=>{const r=await tab.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${out}/${name}.png`,Buffer.from(r.data,'base64'))};
const me={id:'me_qa',name:'QA Me',created_at:1},alice={id:'alice_member',name:'Alice Member',username:'alice_qa',created_at:1},bob={id:'bob_member',name:'Bob Member',created_at:1};
const fixture={me,email:'synthetic@local.test',users:[me,alice,bob],groups:[{id:'group_qa',name:'Group',owner:me.id,members:[me.id,bob.id],invite:'synthetic',channels:[{id:'text_qa',name:'room',kind:'text',unreadMentionCount:2},{id:'voice_qa',name:'voice',kind:'voice'}]}],dialogs:[{id:'room_a',name:'Mention Room A',members:[me.id,alice.id,bob.id]},{id:'room_b',name:'Mention Room B',members:[me.id,alice.id],unreadMentionCount:1}],messages:[],stickers:[],friends:[],bots:[],dialogCalls:[],voicePresence:{},humanTypingSupported:false,humanTyping:[],readReceiptsSupported:true,chatPreferences:{notifications:{direct:true,groups:true},dialogs:{}}};
const init=`window.qaState=${JSON.stringify(fixture)};window.qaOps=[];window.qaSent=[];window.qaErrors=[];window.qaFail=false;window.fetch=async(url,opts={})=>{if(!String(url).startsWith('/api'))throw Error('Blocked unexpected fetch '+url);const b=JSON.parse(opts.body||'{}');qaOps.push(b);let data={};if(b.op==='me')data=qaState.me;if(b.op==='state')data=structuredClone(qaState);if(b.op==='sessions')data=[];if(b.op==='message'){if(qaFail)return new Response(JSON.stringify({error:'Synthetic send rejected'}),{status:400,headers:{'content-type':'application/json'}});qaSent.push(b);const m={id:'sent_'+qaOps.length,channel:b.channel,user:qaState.me.id,text:b.text||'',mentions:b.mentions,time:Date.now()/1000};qaState.messages.push(m);data=m}return new Response(JSON.stringify({data}),{status:200,headers:{'content-type':'application/json'}})};addEventListener('error',e=>qaErrors.push(e.message));addEventListener('unhandledrejection',e=>qaErrors.push(String(e.reason)));`;
const push=message=>tab.ev(`qaState.messages.push(${JSON.stringify(message)})`);
setTimeout(()=>{appendFileSync(out+'/progress.log','WATCHDOG timeout\n');process.exit(2)},300000).unref();
try{
 const wp=await port(),cp=await port();
 server=await createServer({server:{host:'127.0.0.1',port:wp,strictPort:true,watch:{ignored:['**/*-qa/**','**/target/**','**/data/**']}}});
 await server.listen();
 chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-sandbox','--disable-gpu','--mute-audio','--no-first-run','--remote-debugging-port='+cp,'--user-data-dir='+process.cwd()+'/'+out+'/browser','about:blank'],{stdio:'ignore',windowsHide:true});
 const pages=await until(async()=>{const p=await(await fetch(`http://127.0.0.1:${cp}/json`)).json();return p.length&&p},'CDP');
 tab=await connect(pages.find(x=>x.type==='page').webSocketDebuggerUrl);
 await tab.send('Page.enable');await tab.send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
 await tab.send('Page.addScriptToEvaluateOnNewDocument',{source:init});
 await tab.send('Page.navigate',{url:`http://127.0.0.1:${wp}/#chat`});
 await tab.wait(`!!document.querySelector('.dialog-list button')`);
 const dialogBadge=await tab.ev(`${q('.dialog-list .unread-mention-badge')}?.outerHTML||''`);
 ok(/>@<\/span>/.test(dialogBadge)&&/aria-label="Есть непрочитанные упоминания: 1"/.test(dialogBadge),'Dialog list shows one compact @ beside the unread counter: '+dialogBadge);
 await click('button.server[aria-label="Group"]');
 await tab.wait(`!!document.querySelector('.channel-list .channel')`);
 const channelBadge=await tab.ev(`${q('.channel-list .unread-mention-badge')}?.outerHTML||''`);
 ok(/>@2<\/span>/.test(channelBadge)&&/aria-label="Есть непрочитанные упоминания: 2"/.test(channelBadge),'Channel list shows the same @ badge with its own count: '+channelBadge);
 await click('button.server[title="Личные сообщения"]');
 await tab.ev(`(()=>{const a=[...document.querySelectorAll('.dialog-list button')],e=a.find(x=>x.textContent.includes('Mention Room A'));e.dataset.qaRoom='target'})()`);
 await click('[data-qa-room="target"]');await tab.ev(`delete document.querySelector('[data-qa-room="target"]').dataset.qaRoom`);
 await tab.wait(`!!${q(textarea)}`);
 await text('@al');await tab.wait(`!!${q(mentions)}`);await key('Enter');
 ok((await value()).trim()==='@alice_qa'&&!(await value()).includes('alice_member'),'Menu inserts only the visible alias token, never an id or markup: '+(await value()));
 await type('привет');await key('Enter');
 await until(async()=>await sentCount()===1,'first send');
 const first=await lastMessage();
 assert.equal(first.text,'@alice_qa привет');
 assert.deepEqual(first.mentions,[{userId:'alice_member',start:0,end:9}]);
 assert.equal(first.text.slice(first.mentions[0].start,first.mentions[0].end),'@alice_qa');
 ok(true,'Enter sends the verified UTF-16 span for the selected member: '+JSON.stringify({text:first.text,mentions:first.mentions}));
 await text('@bo');await tab.wait(`!!${q(mentions)}`);await key('Enter');
 await type('?');await tab.ev('qaFail=true');await key('Enter');
 await tab.wait(`document.body.innerText.includes('Synthetic send rejected')`);
 ok((await value())==='@Bob Member ?','Rejected send keeps the draft and its recorded span: '+(await value()));
 await tab.ev('qaFail=false');await key('Enter');
 await until(async()=>await sentCount()===2,'retry send');
 const retry=await lastMessage();
 assert.equal(retry.text,'@Bob Member ?');
 assert.deepEqual(retry.mentions,[{userId:'bob_member',start:0,end:11}]);
 ok(true,'Retry after a backend error keeps the same offsets: '+JSON.stringify(retry.mentions));
 await text('@al');await tab.wait(`!!${q(mentions)}`);await key('Enter');
 await tab.ev(`(()=>{const t=${q(textarea)};t.setSelectionRange(3,3);t.dispatchEvent(new Event('select',{bubbles:true}))})()`);
 await type('x');await key('Escape');await tab.wait(`!${q(mentions)}`);await key('Enter');
 await until(async()=>await sentCount()===3,'revoked send');
 const revoked=await lastMessage();
 assert.equal(revoked.text,'@alxice_qa');
 assert.deepEqual(revoked.mentions,[]);
 ok(true,'Editing inside the token revokes the identity instead of sending a stale range');
 const incoming='Привет, @alice_qa, как дела?';
 await push({id:'incoming_1',channel:'room_a',user:'bob_member',text:incoming,time:Date.now()/1000,mentions:[{userId:'alice_member',start:incoming.indexOf('@alice_qa'),end:incoming.indexOf('@alice_qa')+9}]});
 const tag=await tab.wait(`(()=>{const b=[...document.querySelectorAll('.message-mention')].find(e=>e.textContent==='@alice_qa'&&e.parentElement.textContent.includes('как дела'));return b?b.outerHTML:''})()`);
 ok(/^<button[^>]*class="message-mention"/.test(tag)&&!/href=/.test(tag),'Verified mention renders as a button tag, not a link: '+tag);
 const box=await tab.ev(`(()=>{const e=[...document.querySelectorAll('.message-mention')].find(x=>x.textContent==='@alice_qa'&&x.parentElement.textContent.includes('как дела')),r=e.getBoundingClientRect(),s=getComputedStyle(e),p=e.parentElement;return{rect:{w:r.width,h:r.height,x:r.x,y:r.y},display:s.display,color:s.color,background:s.backgroundColor,opacity:s.opacity,visibility:s.visibility,paragraph:p.tagName,parentText:p.textContent}})()`);
 ok(box.rect.w>0&&box.rect.w<120&&box.rect.h>0&&box.rect.h<26&&box.visibility==='visible'&&Number(box.opacity)>0&&/^inline/.test(box.display)&&/rgb\(169, 204, 255\)/.test(box.color)&&box.parentText==='Привет, @alice_qa, как дела?','Tag is a visible inline text run inside the sentence: '+JSON.stringify(box));
 await shot('rendered-mention');
 await tab.ev(`[...document.querySelectorAll('.message-mention')].find(e=>e.textContent==='@alice_qa').click()`);
 await tab.wait(`!!document.querySelector('.user-profile')`);
 const profile=await tab.ev(`document.querySelector('.user-profile').innerText`);
 ok(profile.includes('Alice Member')&&!(await tab.ev('qaErrors.length')),'Tag click opens the member profile by immutable id');
 await tab.ev(`document.querySelector('.user-profile-close')?.click()`);
 await push({id:'incoming_2',channel:'room_b',user:'alice_member',text:'@QA Me ответь, пожалуйста',time:Date.now()/1000,mentions:[{userId:'me_qa',start:0,end:6}]});
 const toast=await tab.wait(`(()=>{const t=document.querySelector('.direct-message-toast');return t&&t.innerText.includes('Вас упомянули')?t.innerText:''})()`);
 ok(toast.includes('Alice Member')&&toast.includes('@QA Me'),'Addressed notification names the mention while keeping the sender: '+toast.replace(/\n/g,' | '));
 await shot('notification');
 ok(await tab.ev('qaErrors.length===0'),'No browser errors');
}catch(e){errors.push(String(e));process.exitCode=1;if(tab){errors.push(JSON.stringify(await tab.ev(`({text:document.body.innerText.slice(-2600),errors:qaErrors,ops:qaOps.slice(-4)})`).catch(()=>null)));await shot('failure').catch(()=>{})}}
finally{
 for(const s of sockets)s.close();
 if(chrome&&chrome.exitCode===null)await new Promise(r=>{chrome.once('exit',r);chrome.kill()});
 if(server)await new Promise(r=>server.httpServer.close(r));
 const result={passed:checks.length,checks,errors,output:out,limitations:['Genuine source React LiveChat and installed assistant-ui; synthetic fetch boundary, so no real backend, private accounts or production data','No native Windows toast/OS focus/audio verified; only the in-app toast surface','Send failure simulated by HTTP 400 from the synthetic boundary']};
 writeFileSync(out+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 process.exit(errors.length?1:0);
}
