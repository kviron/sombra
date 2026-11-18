// Real built React DOM + synthetic API/Tauri IPC boundaries. No real accounts or OS focus claims.
import assert from 'node:assert/strict';
import {preview} from 'vite';
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import net from 'node:net';
assert(process.argv.includes('--built-ready'),'Run npx vite build --outDir chat-scroll-qa/dist --emptyOutDir first, then node check-chat-scroll-browser.mjs --built-ready');
const out=`chat-scroll-qa/run-${Date.now()}`,checks=[],errors=[],sockets=[];mkdirSync(out,{recursive:true});
let server,chrome,tab;const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(f,label){let last;for(let i=0;i<120;i++){try{const v=await f();if(v)return v}catch(e){last=e}await sleep(100)}throw Error('Timeout '+label+' '+(last?.message||''))}
async function port(){return new Promise((r,j)=>{const s=net.createServer();s.once('error',j);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p))})})}
async function connect(url){const ws=new WebSocket(url);sockets.push(ws);await new Promise(r=>ws.addEventListener('open',r,{once:true}));let id=0;const pending=new Map();ws.addEventListener('message',e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p[1](Error(m.error.message)):p[0](m.result)}});const send=(method,params={})=>new Promise((r,j)=>{const n=++id;pending.set(n,[r,j]);ws.send(JSON.stringify({id:n,method,params}))});const ev=async expression=>{const v=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(v.exceptionDetails)throw Error(JSON.stringify(v.exceptionDetails));return v.result.value};return{send,ev,wait:e=>until(()=>ev(e),e)}}
const q=s=>`document.querySelector(${JSON.stringify(s)})`;
async function click(selector){await tab.wait(`!!${q(selector)}`);const p=await tab.ev(`(()=>{const e=${q(selector)};e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);for(const type of ['mousePressed','mouseReleased'])await tab.send('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1});await sleep(450)}
function ok(v,label){assert(v,label);checks.push(label);console.log('PASS '+label)}
const me={id:'qa_me',name:'QA Owner',bio:'',created_at:1},peer={id:'qa_peer',name:'QA Sender',bio:'',created_at:1};
const fixture={me,email:'qa@local.test',users:[me,peer],groups:[{id:'qa_group',name:'QA Group',owner:me.id,members:[me.id,peer.id],invite:'synthetic',channels:[{id:'qa_text',name:'qa-text',kind:'text'},{id:'qa_voice',name:'qa-voice',kind:'voice'}]}],dialogs:[{id:'qa_dm',name:'',members:[me.id,peer.id]},{id:'qa_other',name:'Other QA',members:[me.id,peer.id]}],readReceiptsSupported:true,messages:Array.from({length:90},(_,i)=>({id:`row_${i}`,channel:'qa_dm',user:peer.id,text:`Message ${i}: `+'Scrolling history with repeated words. '.repeat(6),time:1700000000+i})),stickers:[],friends:[],bots:[],dialogCalls:[],voicePresence:{},chatPreferences:{notifications:{direct:true,groups:true},dialogs:{}}};
const init=`window.qaState=${JSON.stringify(fixture)};window.qaCalls=[];window.qaErrors=[];window.qaQueue=[];window.qaListeners={};window.qaCallbacks={};let seq=0;
window.qaApi=async b=>{qaCalls.push({command:'api',...b});if(b.op==='me')return qaState.me;if(b.op==='state'){if(window.qaDelay)await new Promise(r=>setTimeout(r,qaDelay));return structuredClone(window.qaFresh||qaState)}if(b.op==='sessions')return [];return {}};
window.fetch=async(url,opts)=>{if(String(url).startsWith('/api'))return new Response(JSON.stringify({data:await qaApi(JSON.parse(opts.body))}),{status:200,headers:{'content-type':'application/json'}});throw Error('Blocked unexpected fetch '+url)};
if(sessionStorage.qaNative){window.isTauri=true;window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:f=>{const id=++seq;qaCallbacks[id]=f;return id},unregisterCallback:id=>delete qaCallbacks[id],invoke:async(command,args={})=>{qaCalls.push({command,args});if(command==='remote_api')return qaApi(args.request);if(command==='plugin:event|listen'){qaListeners[args.event]=args.handler;return ++seq}if(command==='take_notification_target')return qaQueue.shift()||null;if(command==='plugin:window|is_focused')return false;if(command==='notify_direct_message'){if(window.qaFallback)throw Error('synthetic popup unavailable');return null}if(command.includes('is_maximized'))return false;return null}};window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener(){}};if(sessionStorage.qaInitial){qaQueue.push(JSON.parse(sessionStorage.qaInitial));sessionStorage.removeItem('qaInitial')}}
window.qaActivate=t=>{qaQueue.push(t);const cb=qaCallbacks[qaListeners['notification-activate']];if(!cb)throw Error('activation listener missing');cb({event:'notification-activate',payload:null})};
addEventListener('error',e=>qaErrors.push(e.message));addEventListener('unhandledrejection',e=>qaErrors.push(String(e.reason)));`;
try{
 const webPort=await port(),cdp=await port();server=await preview({configFile:false,build:{outDir:'chat-scroll-qa/dist'},preview:{host:'127.0.0.1',port:webPort,strictPort:true}});
 chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-sandbox','--disable-gpu','--mute-audio','--no-first-run','--remote-debugging-port='+cdp,'--user-data-dir='+process.cwd()+'/'+out+'/browser','about:blank'],{stdio:'ignore',windowsHide:true});
 const pages=await until(async()=>{const p=await(await fetch(`http://127.0.0.1:${cdp}/json`)).json();return p.length&&p},'Chrome CDP');tab=await connect(pages.find(p=>p.type==='page').webSocketDebuggerUrl);await tab.send('Page.enable');await tab.send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});await tab.send('Page.addScriptToEvaluateOnNewDocument',{source:init});await tab.send('Page.navigate',{url:`http://127.0.0.1:${webPort}/#chat`});await tab.wait(`!!${q('.profile-name strong')}`);await sleep(300);
 const scope=`${JSON.stringify('sombra-chat-scroll-v1:') }+JSON.stringify(['qa_me','qa_dm'])`;
 const geometry=`(()=>{const r=document.querySelector('.message-scroll'),v=r.getBoundingClientRect(),rows=[...r.querySelectorAll('[data-message-id]')],first=rows.find(e=>e.getBoundingClientRect().bottom>v.top);return {top:r.scrollTop,remaining:r.scrollHeight-r.scrollTop-r.clientHeight,first:first?.dataset.messageId,offset:first?.getBoundingClientRect().top-v.top,label:document.querySelector('.chat-scroll-down')?.getAttribute('aria-label')}})()`;
 const scrollTo=id=>tab.ev(`(()=>{const r=document.querySelector('.message-scroll'),e=document.querySelector('[data-message-id="${id}"]');r.scrollTop+=e.getBoundingClientRect().top-r.getBoundingClientRect().top+12})()`);
 const activate=(channel,message)=>tab.ev(`qaActivate(${JSON.stringify({account:'qa_me',channel,message})})`);
 await tab.ev(`sessionStorage.qaNative='1'`);await tab.send('Page.reload');await tab.wait(`!!qaListeners['notification-activate']`);
 await click('[data-dialog-id="qa_dm"] button');await tab.wait(`!!document.querySelector('[data-message-id="row_89"]')`);
 await tab.wait(`${geometry}.remaining<=8`);
 await tab.wait(`localStorage.getItem((${scope})+':read')==='row_89'`);
 await scrollTo('row_20');await tab.wait(`${geometry}.label==='К последнему прочитанному сообщению'`);
 const stored=await tab.ev(geometry);
 await click('[data-dialog-id="qa_other"] button');await tab.wait(`!document.querySelector('[data-message-id="row_89"]')`);
 await click('[data-dialog-id="qa_dm"] button');await tab.wait(`${geometry}.first===${JSON.stringify(stored.first)}`);
 ok(Math.abs((await tab.ev(geometry)).offset-stored.offset)<=2,'Chat switch restores row and pixel offset');
 await tab.send('Page.reload');await click('[data-dialog-id="qa_dm"] button');
 await tab.wait(`document.querySelector('[data-message-id="row_89"]')&&${geometry}.first===${JSON.stringify(stored.first)}`);
 ok(Math.abs((await tab.ev(geometry)).offset-stored.offset)<=2,'Reload restores row and pixel offset');
 // Simulate a read marker deeper in history, with unread rows after it.
 await tab.ev(`localStorage.setItem((${scope})+':read','row_55')`);
 await tab.send('Page.reload');await click('[data-dialog-id="qa_dm"] button');await tab.wait(`${geometry}.label==='К последнему прочитанному сообщению'`);
 await click('.chat-scroll-down');
 ok(await tab.ev(`(()=>{const r=document.querySelector('.message-scroll').getBoundingClientRect(),e=document.querySelector('[data-message-id="row_55"]').getBoundingClientRect();return e.top>r.top&&e.bottom<r.bottom&&${geometry}.remaining>8})()`),'First click shows the last message read by this account without jumping to bottom');
 await tab.wait(`${geometry}.label==='В конец чата'`);await click('.chat-scroll-down');
 ok(await tab.ev(`${geometry}.remaining<=8&&!${geometry}.label`),'Second click reaches bottom and hides button');
 await click('[data-dialog-id="qa_other"] button');
 const targetVisible=`(()=>{const r=document.querySelector('.message-scroll')?.getBoundingClientRect(),m=document.querySelector('[data-message-id="row_12"].message-jump-highlight')?.getBoundingClientRect();return r&&m&&m.top>r.top+50&&m.bottom<r.bottom-50})()`;
 await activate('qa_dm','row_12');await tab.wait(targetVisible);
 ok(await tab.ev(`${geometry}.remaining>100`),'Cross-chat notification target overrides saved bottom position');
 await scrollTo('row_35');await tab.wait(`!${targetVisible}`);await activate('qa_dm','row_12');await tab.wait(targetVisible);
 ok(true,'The same notification target scrolls into view again before highlight expiry');
 await tab.ev(`localStorage.setItem('sombra-chat-scroll-v1:'+JSON.stringify(['other-account','qa_dm']),JSON.stringify({id:'row_3',offset:-12}));qaState.me={...qaState.me,id:'other-account',name:'Other Account'}`);
 await tab.wait(`${geometry}.first==='row_3'`);
 ok(await tab.ev(`JSON.parse(localStorage.getItem((${scope}))).id!=='row_3'`),'Account change restores the other account’s independent anchor');
 ok((await tab.ev('qaErrors')).length===0,'No browser errors');
}catch(e){errors.push(String(e));console.error(e);if(tab)console.error(await tab.ev(`({errors:qaErrors,calls:qaCalls.slice(-8),storage:{...localStorage}})`).catch(()=>null));process.exitCode=1}
finally{for(const s of sockets)s.close();if(server)await new Promise(r=>server.httpServer.close(r));if(chrome&&chrome.exitCode===null)await new Promise(r=>{chrome.once('exit',r);chrome.kill()});writeFileSync(`${out}/result.json`,JSON.stringify({checks,errors},null,2))}
