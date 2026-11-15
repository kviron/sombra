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
 const bounds=selector=>a.ev(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+100,width:r.width}})()`);
 const drag=async(selector,dx)=>{const r=await bounds(selector);await a.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:r.x,y:r.y});await a.send('Input.dispatchMouseEvent',{type:'mousePressed',x:r.x,y:r.y,button:'left',clickCount:1});await new Promise(r=>setTimeout(r,100));await a.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:r.x+dx,y:r.y,button:'left',buttons:1});await new Promise(r=>setTimeout(r,100));await a.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:r.x+dx,y:r.y,button:'left',clickCount:1});await new Promise(r=>setTimeout(r,100));};
 const initial=(await bounds('.channel-sidebar')).width;
 await drag('.channel-sidebar>.column-resizer',100);
 assert.equal((await bounds('.channel-sidebar')).width,initial+100);
 await drag('.channel-sidebar>.column-resizer',-100);
 await a.ev("document.querySelector('.header-actions button[title=\"Участники\"]').click()");
 const member=(await bounds('.member-list')).width;
 await drag('.member-list>.column-resizer',-80);
 assert.equal((await bounds('.member-list')).width,member+80);
 await shot('resized-members');
 await a.ev("document.querySelector('.header-actions button[title=\"Участники\"]').click()");
 await a.ev("document.querySelector('.channel svg[class*=volume]').closest('button').click()");
 await a.wait("!!document.querySelector('.voice-layout')");
 const voice=(await bounds('.voice-messages')).width;
 await drag('.voice-layout>.column-resizer',-100);
 assert.equal((await bounds('.voice-messages')).width,voice+100);
 assert.equal(await a.ev("document.body.style.cursor"),'');
 await shot('resized-voice-chat');
 await drag('.voice-layout>.column-resizer',-1000);
 assert.ok((await bounds('.voice-messages')).width<=600);
 await drag('.voice-layout>.column-resizer',1000);
 assert.equal((await bounds('.voice-messages')).width,260);
 for(const width of [1080,720]){
 await a.send('Emulation.setDeviceMetricsOverride',{width,height:720,deviceScaleFactor:1,mobile:false});
 assert.equal(await a.ev("document.documentElement.scrollWidth>innerWidth"),false);
 await shot('resized-'+width);
 }
 console.log('PASS: sidebar, members and voice chat mouse resizing; min/max bounds; cursor cleanup; narrow viewports.');
}finally{sockets.forEach(s=>s.close());chrome.kill();await new Promise(r=>server.httpServer.close(r))}