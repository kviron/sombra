import {preview} from 'vite';
import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const server=await preview({preview:{host:'127.0.0.1',port:4191,strictPort:true}});
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-sandbox','--disable-gpu-sandbox','--disable-gpu','--no-first-run','--remote-debugging-port=9332','--user-data-dir='+process.cwd()+'/auth-qa/browser-profile','about:blank'],{windowsHide:true,stdio:'ignore'});
let ws;
try {
 let pages;for(let i=0;i<80;i++){try{pages=await(await fetch('http://127.0.0.1:9332/json')).json();break}catch{await new Promise(r=>setTimeout(r,100))}}
 ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
 let id=0;const pending=new Map();ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(pending.has(m.id)){const [resolve,reject]=pending.get(m.id);pending.delete(m.id);m.error?reject(m.error):resolve(m.result)}});
 const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,[resolve,reject]);ws.send(JSON.stringify({id:n,method,params}))});
 const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value};
 const wait=async expression=>{for(let i=0;i<120;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100))}throw new Error('Timed out: '+expression)};
 const shot=async name=>{await evaluate('document.fonts.ready');const result=await send('Page.captureScreenshot',{format:'png'});writeFileSync('auth-qa/'+name+'.png',Buffer.from(result.data,'base64'));};
 await send('Network.clearBrowserCookies');
 await send('Emulation.setDeviceMetricsOverride',{width:1920,height:1028,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:'http://127.0.0.1:4191/#chat'});await wait("!!document.querySelector('#login-title')");assert.equal(await evaluate("!!document.querySelector('.chat-shell')"),false);await shot('brand-login');await evaluate("window.location.hash='#register'");await new Promise(r=>setTimeout(r,500));assert.equal(await evaluate('window.location.hash'),'#register');await evaluate("window.location.hash='#login'");await wait("!!document.querySelector('#login-title')");
 await evaluate("document.querySelector('[name=remember_me]').click()");assert.equal(await evaluate("document.querySelector('[name=remember_me]').checked"),true);await shot('brand-remember');
 const text=readFileSync('data/FIRST-USER.txt','utf8');const email=text.match(/Email: (.+)/)[1].trim(),password=text.match(/Password: (.+)/)[1].trim();
 await evaluate(`document.querySelector('#email').value=${JSON.stringify(email)};document.querySelector('#password').value=${JSON.stringify(password)};document.querySelector('form').requestSubmit()`);
 await wait("!!document.querySelector('.profile-name strong') && document.querySelector('.profile-name strong').textContent !== 'Загрузка…'");
 await shot('brand-chat');
 await evaluate("document.querySelectorAll('.channel')[4]?.click()");
 await new Promise(r=>setTimeout(r,500));await shot('brand-voice');
 await evaluate("document.querySelector('.profile-bar button:last-child')?.click()");
 await new Promise(r=>setTimeout(r,500));await shot('brand-settings');
 console.log('Brand screenshots captured; login and chat rendered.');
} finally {ws?.close();chrome.kill();await new Promise(r=>server.httpServer.close(r))}
