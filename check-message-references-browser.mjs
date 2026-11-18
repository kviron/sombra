// Isolated Chrome CDP smoke with synthetic state and API; never connects to production.
// PowerShell: npx vite build --outDir "$env:TEMP/sombra-reference-dist" --emptyOutDir
// Then: node check-message-references-browser.mjs
import assert from 'node:assert/strict';
import {preview} from 'vite';
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import net from 'node:net';
const out=`${process.env.TEMP}/sombra-reference-run-${Date.now()}`,checks=[],errors=[],sockets=[];mkdirSync(out,{recursive:true});
let server,chrome,tab;const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(f,label){let last;for(let i=0;i<120;i++){try{const v=await f();if(v)return v}catch(e){last=e}await sleep(100)}throw Error('Timeout '+label+' '+(last?.message||''))}
async function port(){return new Promise((r,j)=>{const s=net.createServer();s.once('error',j);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p))})})}
async function connect(url){const ws=new WebSocket(url);sockets.push(ws);await new Promise(r=>ws.addEventListener('open',r,{once:true}));let id=0;const pending=new Map();ws.addEventListener('message',e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p[1](Error(m.error.message)):p[0](m.result)}});const send=(method,params={})=>new Promise((r,j)=>{const n=++id;pending.set(n,[r,j]);ws.send(JSON.stringify({id:n,method,params}))});const ev=async expression=>{const v=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(v.exceptionDetails)throw Error(JSON.stringify(v.exceptionDetails));return v.result.value};return{send,ev,wait:e=>until(()=>ev(e),e)}}
const q=s=>`document.querySelector(${JSON.stringify(s)})`;
async function click(selector){await tab.wait(`!!${q(selector)}`);const p=await tab.ev(`(()=>{const e=${q(selector)};e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);for(const type of ['mousePressed','mouseReleased'])await tab.send('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1});await sleep(450)}
function ok(v,label){assert(v,label);checks.push(label);console.log('PASS '+label)}
const me={id:'qa_me',name:'QA Owner',bio:'',created_at:1},peer={id:'qa_peer',name:'QA Sender',bio:'',created_at:1};
const fixture={me,email:'qa@local.test',users:[me,peer],groups:[{id:'qa_group',name:'QA Group',owner:me.id,members:[me.id,peer.id],invite:'synthetic',channels:[{id:'qa_text',name:'qa-text',kind:'text'},{id:'qa_voice',name:'qa-voice',kind:'voice',unreadCount:7}]}],dialogs:[{id:'qa_dm',name:'',members:[me.id,peer.id]},{id:'qa_other',name:'Other QA',members:[me.id,peer.id]}],readReceiptsSupported:true,messages:Array.from({length:90},(_,i)=>({id:`row_${i}`,channel:'qa_dm',user:peer.id,text:`Message ${i}: `+'Scrolling history with repeated words. '.repeat(6),time:1700000000+i})),stickers:[],friends:[],bots:[],dialogCalls:[],voicePresence:{},chatPreferences:{notifications:{direct:true,groups:true},dialogs:{}}};
const init=`window.qaState=${JSON.stringify(fixture)};qaState.features={messageReferences:true};qaState.messages.at(-1).replyTo={id:"row_0",author:"qa_peer",text:"Quoted original"};qaState.messages.push(...qaState.messages.map(m=>({...m,id:'voice_'+m.id,channel:'qa_voice',replyTo:undefined})));window.qaCalls=[];window.qaErrors=[];window.qaQueue=[];window.qaListeners={};window.qaCallbacks={};let seq=0;
window.qaApi=async b=>{qaCalls.push({command:'api',...b});if(b.op==='me')return qaState.me;if(b.op==='state'){if(window.qaDelay)await new Promise(r=>setTimeout(r,qaDelay));return structuredClone(window.qaFresh||qaState)}if(b.op==='sessions')return [];if(b.op==='forward_message')return {messages:[]};return {}};
window.fetch=async(url,opts)=>{if(String(url).startsWith('/api'))return new Response(JSON.stringify({data:await qaApi(JSON.parse(opts.body))}),{status:200,headers:{'content-type':'application/json'}});throw Error('Blocked unexpected fetch '+url)};
if(sessionStorage.qaNative){window.isTauri=true;window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:f=>{const id=++seq;qaCallbacks[id]=f;return id},unregisterCallback:id=>delete qaCallbacks[id],invoke:async(command,args={})=>{qaCalls.push({command,args});if(command==='remote_api')return qaApi(args.request);if(command==='plugin:event|listen'){qaListeners[args.event]=args.handler;return ++seq}if(command==='take_notification_target')return qaQueue.shift()||null;if(command==='plugin:window|is_focused')return false;if(command==='notify_direct_message'){if(window.qaFallback)throw Error('synthetic popup unavailable');return null}if(command.includes('is_maximized'))return false;return null}};window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener(){}};if(sessionStorage.qaInitial){qaQueue.push(JSON.parse(sessionStorage.qaInitial));sessionStorage.removeItem('qaInitial')}}
window.qaActivate=t=>{qaQueue.push(t);const cb=qaCallbacks[qaListeners['notification-activate']];if(!cb)throw Error('activation listener missing');cb({event:'notification-activate',payload:null})};
addEventListener('error',e=>qaErrors.push(e.message));addEventListener('unhandledrejection',e=>qaErrors.push(String(e.reason)));`;
try{
 const webPort=await port(),cdp=await port();server=await preview({configFile:false,build:{outDir:process.env.TEMP+'/sombra-reference-dist'},preview:{host:'127.0.0.1',port:webPort,strictPort:true}});
 chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-sandbox','--disable-gpu','--mute-audio','--no-first-run','--remote-debugging-port='+cdp,'--user-data-dir='+out+'/browser','about:blank'],{stdio:'ignore',windowsHide:true});
 const pages=await until(async()=>{const p=await(await fetch(`http://127.0.0.1:${cdp}/json`)).json();return p.length&&p},'Chrome CDP');tab=await connect(pages.find(p=>p.type==='page').webSocketDebuggerUrl);await tab.send('Page.enable');await tab.send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});await tab.send('Page.addScriptToEvaluateOnNewDocument',{source:init});await tab.send('Page.navigate',{url:`http://127.0.0.1:${webPort}/#chat`});await tab.wait(`!!${q('.profile-name strong')}`);await sleep(300);
 const scope=`${JSON.stringify('sombra-chat-scroll-v1:') }+JSON.stringify(['qa_me','qa_dm'])`;
 await click('[data-dialog-id="qa_dm"] button');
 await click('[data-read-message-id="row_89"] .message-reference');
 await tab.wait(`!!document.querySelector('[data-message-id="row_0"].message-jump-highlight')`);
 const menu=async(label)=>{await tab.ev(`(()=>{let e=document.querySelector('[data-read-message-id="row_0"]');e.scrollIntoView({block:'center'});let r=e.getBoundingClientRect();e.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:r.x+100,clientY:r.y+10}))})()`);await tab.wait(`[...document.querySelectorAll('[role=menuitem]')].some(e=>e.textContent.trim()===${JSON.stringify(label)})`);await tab.ev(`[...document.querySelectorAll('[role=menuitem]')].find(e=>e.textContent.trim()===${JSON.stringify(label)}).click()`);};
 await menu('Ответить');await tab.wait(`!!document.querySelector('.reference-draft')`);
 await tab.ev(`document.querySelector('.composer-chrome textarea').focus()`);await tab.send('Input.insertText',{text:'My reply'});await tab.ev(`document.querySelector('.composer-chrome form').requestSubmit()`);await tab.wait(`qaCalls.some(c=>c.op==='message'&&c.replyTo==='row_0'&&c.text==='My reply')`);
 await menu('Переслать');await tab.wait(`!!document.querySelector('.forward-picker input')`);await tab.ev(`document.querySelector('.forward-picker input').focus()`);await tab.send('Input.insertText',{text:'qa-voice'});await tab.wait(`document.querySelectorAll('.forward-picker li').length===1`);
 await click('.forward-picker li button');await tab.wait(`!!document.querySelector('.voice-messages')&&!!document.querySelector('.forward-composer')`);
 assert(!(await tab.ev(`qaCalls.some(c=>c.op==='forward_message')`)));
 await tab.wait(`!!document.querySelector('.room-music-add')`);
 for (const width of [416,300,240]) {
  const [form,link,count,action]=await tab.ev(`(()=>{const w=document.querySelector('.room-music');w.style.width='${width}px';const f=w.querySelector('.room-music-add');const rect=e=>{const {left,right,bottom}=e.getBoundingClientRect();return {left,right,bottom}};return [rect(f),...[...f.querySelectorAll('input,button')].map(rect)]})()`);
  assert([link,count,action].every(r=>r.left>=form.left-1&&r.right<=form.right+1), `controls fit at ${width}px`);
  assert(Math.abs(count.bottom-action.bottom)<1, `count and action align at ${width}px`);
  assert(width===416?Math.abs(link.bottom-action.bottom)<1:link.bottom<count.bottom, `row arrangement at ${width}px`);
 }
 await tab.ev(`document.querySelector('.room-music').style.removeProperty('width')`);
 console.log('Music widget layout at 416, 300 and 240 px: passed');
 await tab.ev(`document.querySelector('.voice-messages').scrollTop=0`);
 await tab.wait(`document.querySelector('.chat-scroll-down .chat-scroll-unread')?.textContent==='7'`);
 await click('.chat-scroll-down');
 await tab.wait(`!document.querySelector('.chat-scroll-down')`);
 console.log('Voice chat unread badge and down arrow: passed');
 await click('.forward-composer textarea');await tab.send('Input.insertText',{text:'My separate comment'});await click('.forward-composer button[type=submit]');await tab.wait(`qaCalls.some(c=>c.op==='forward_message'&&c.message==='row_0'&&c.channel==='qa_voice'&&c.comment==='My separate comment')`);await tab.wait(`!document.querySelector('.forward-composer')`);
 console.log('Quote scroll/highlight, reply payload, destination search/navigation, no implicit send, single atomic forward request: passed');
} finally { sockets.forEach(ws=>ws.close());chrome?.kill();if(server)await new Promise(r=>server.httpServer.close(r)); }
