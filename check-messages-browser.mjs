import {preview} from 'vite';
import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
mkdirSync('voice-qa',{recursive:true});
const server=await preview({preview:{host:'127.0.0.1',port:4193,strictPort:true}});
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-sandbox','--disable-gpu','--no-first-run','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required','--remote-debugging-port=9334','--user-data-dir='+process.cwd()+'/voice-qa/browser-profile','about:blank'],{windowsHide:true,stdio:'ignore'});
const sockets=[];
async function connect(url){const ws=new WebSocket(url);sockets.push(ws);await new Promise(r=>ws.addEventListener('open',r,{once:true}));let id=0;const pending=new Map();ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(pending.has(m.id)){const [resolve,reject]=pending.get(m.id);pending.delete(m.id);m.error?reject(m.error):resolve(m.result)}});const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,[resolve,reject]);ws.send(JSON.stringify({id:n,method,params}))});const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value};const wait=async expression=>{for(let i=0;i<160;i++){if(await ev(expression))return;await new Promise(r=>setTimeout(r,100))}throw new Error('Timeout '+expression+' '+await ev('document.body.innerText'))};await send('Page.enable');await send('Page.addScriptToEvaluateOnNewDocument',{source:`window.pcs=[];window.media=[];const Original=window.RTCPeerConnection;window.RTCPeerConnection=class extends Original{constructor(...args){super(...args);window.pcs.push(this)}};const gum=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async(...args)=>{const s=await gum(...args);window.media.push(s);return s}`});return {send,ev,wait};}
try{
 let pages;for(let i=0;i<80;i++){try{pages=await(await fetch('http://127.0.0.1:9334/json')).json();break}catch{await new Promise(r=>setTimeout(r,100))}}
 const a=await connect(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
 await a.send('Emulation.setDeviceMetricsOverride',{width:1920,height:1028,deviceScaleFactor:1,mobile:false});
 await a.send('Page.navigate',{url:'http://127.0.0.1:4193/#login'});await a.wait("!!document.querySelector('#email')");
 const text=readFileSync('data/FIRST-USER.txt','utf8');const email=text.match(/Email: (.+)/)[1].trim(),password=text.match(/Password: (.+)/)[1].trim();
 await a.ev(`document.querySelector('#email').value=${JSON.stringify(email)};document.querySelector('#password').value=${JSON.stringify(password)};document.querySelector('form').requestSubmit()`);await a.wait("!!document.querySelector('.profile-name strong')");
 const shot=async(name)=>{await a.ev('document.fonts.ready');const result=await a.send('Page.captureScreenshot',{format:'png'});writeFileSync('voice-qa/'+name+'.png',Buffer.from(result.data,'base64'))};

 // Preview-only fixture: no messages are posted to a real conversation.
 await a.ev(`window.originalFetch=window.fetch;window.fetch=async (...args)=>{const response=await window.originalFetch(...args);let request;try{request=JSON.parse(args[1]?.body||'{}')}catch{}if(request?.op!=='state')return response;const payload=await response.clone().json();const s=payload.data;const channel=s.groups[0].channels.find(c=>c.name==='games').id;const t=1794646800;s.messages=[{id:'qa-in',channel,user:'qa-friend',text:'Привет! Во что играем сегодня?',time:t},{id:'qa-out',channel,user:s.me.id,text:'Давай в Dota 2 👋\\nБуду через десять минут.',time:t+60},{id:'qa-follow',channel,user:s.me.id,text:'One more message',time:t+90},{id:'qa-next-day',channel,user:s.me.id,text:'Next day',time:t+86400},{id:'qa-long',channel,user:'qa-friend',text:'Отлично, буду ждать. '+ 'Длинное сообщение '.repeat(25),time:t+86400}];s.users.push({id:'qa-friend',name:'Алексей',bio:'',created_at:t});return new Response(JSON.stringify(payload),{status:200,headers:{'Content-Type':'application/json'}})}`);
 await a.wait("document.querySelectorAll('[data-slot=message]').length===5");
 assert.equal(await a.ev("document.querySelectorAll('[data-align=end]').length"),3);
 assert.equal(await a.ev("document.querySelectorAll('.chat-day').length"),2);
 assert.equal(await a.ev("document.querySelectorAll('[data-grouped=true]').length"),1);
 assert.equal(await a.ev("document.querySelector('[data-grouped=true] [data-slot=message-header]')"),null);
 assert.ok(await a.ev("document.querySelector('[data-grouped=true] .message-bubble').getBoundingClientRect().height<40"));
 await a.ev("document.querySelector('[data-grouped=true] .message-react').click()");
 await a.wait("!!document.querySelector('.reaction-picker')");
 await a.ev("document.querySelector('[data-grouped=true] .message-react').click()");
 await a.ev("document.querySelector('.message-scroll').scrollTop=0");
 await shot('messages-desktop');
 await a.ev("document.querySelector('[title=\"Добавить реакцию\"]').click()");
 await a.wait("!!document.querySelector('.reaction-picker')");
 await a.ev("document.querySelector('[title=\"Закрыть реакции\"]').click()");
 for(const [width,height] of [[1080,720],[720,600]]){
 await a.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
 assert.equal(await a.ev("document.querySelector('.message-scroll').scrollWidth>document.querySelector('.message-scroll').clientWidth"),false);
 await shot('messages-'+width);
 }
 console.log('Message alignment, dates, reaction picker and long-text overflow: passed');
}finally{sockets.forEach(s=>s.close());chrome.kill();await new Promise(r=>server.httpServer.close(r))}
