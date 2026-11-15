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

 await a.ev(`const field=document.querySelector('.composer textarea,.composer input');field.focus();field.value='Проверка ты тут';field.dispatchEvent(new Event('input',{bubbles:true}));`);
 assert.equal(await a.ev("getComputedStyle(document.activeElement).outlineStyle"),'none');
 assert.equal(await a.ev("document.querySelector('.composer').matches(':focus-within')"),true);
 await shot('composer-focus-fixed');
 console.log('Composer focus: one outer indicator, no inner outline. Screenshot captured.');
}finally{sockets.forEach(s=>s.close());chrome.kill();await new Promise(r=>server.httpServer.close(r))}
