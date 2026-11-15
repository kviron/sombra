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
 await send('Emulation.setDeviceMetricsOverride',{width:1920,height:1028,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:'http://127.0.0.1:4191/#chat'});await wait("!!document.querySelector('#login-title')");assert.equal(await evaluate("!!document.querySelector('.chat-shell')"),false);await shot('auth-guest');await evaluate("window.location.hash='#register'");await new Promise(r=>setTimeout(r,500));assert.equal(await evaluate('window.location.hash'),'#register');await evaluate("window.location.hash='#login'");await wait("!!document.querySelector('#login-title')");
 await evaluate("document.querySelector('[name=remember_me]').click()");assert.equal(await evaluate("document.querySelector('[name=remember_me]').checked"),true);await shot('auth-remember');
 const text=readFileSync('data/FIRST-USER.txt','utf8');const email=text.match(/Email: (.+)/)[1].trim(),password=text.match(/Password: (.+)/)[1].trim();
 await evaluate(`document.querySelector('#email').value=${JSON.stringify(email)};document.querySelector('#password').value=${JSON.stringify(password)};document.querySelector('form').requestSubmit()`);
 await wait("!!document.querySelector('.profile-name strong') && document.querySelector('.profile-name strong').textContent !== 'Загрузка…'");
 const cookies=await send('Network.getCookies');const cookie=cookies.cookies.find(c=>c.name==='mines_session');assert.ok(cookie);assert.ok(Math.abs(cookie.expires-Date.now()/1000-31536000)<60);
 assert.equal(await evaluate("document.cookie.includes('mines_session')"),false);await shot('auth-chat');

 const verify=async()=>{assert.equal(await evaluate("document.querySelector('.modal-backdrop').getBoundingClientRect().top"),await evaluate("document.querySelector('.app-surface > header').getBoundingClientRect().bottom"));assert.equal(await evaluate("document.elementFromPoint(20,20).closest('header')===document.querySelector('.app-surface > header')"),true)};
 await evaluate("document.querySelector('.profile button').click()");await wait("!!document.querySelector('.account-modal')");await verify();await shot('modal-settings');
 await evaluate("document.querySelector('.account-modal article header button').click()");
 for(const selector of ['.server-rail button:nth-last-child(2)','.server-rail button:last-child','.channel-sidebar > header button']) {await evaluate('document.querySelector('+JSON.stringify(selector)+').click()');await wait("!!document.querySelector('.group-modal')");await verify();await shot('modal-group');await evaluate("document.querySelector('.group-modal > div:last-child button').click()");} console.log('Modal backdrops stay below the title bar; title bar hit testing passed.');
} finally {ws?.close();chrome.kill();await new Promise(r=>server.httpServer.close(r))}
