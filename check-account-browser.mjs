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

 await send('Page.navigate',{url:'http://127.0.0.1:4191/#login'});await wait("!!document.querySelector('#login-title')");
 const email='settings-'+Date.now()+'@test.local',password='settings-test-password';
 await evaluate(`fetch('/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'register',name:'Test Profile',email:${JSON.stringify(email)},password:${JSON.stringify(password)}})}).then(r=>r.json())`);
 await send('Page.reload');await wait("!!document.querySelector('.profile')");
 await evaluate(`document.querySelector('.profile button:last-child').click()`);await wait("!!document.querySelector('#account-avatar')");
 const doc=await send('DOM.getDocument');const input=await send('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'#account-avatar'});
 await send('DOM.setFileInputFiles',{nodeId:input.nodeId,files:['D:/media/Documents/Craft Anything/discord/reference/picture-1.png']});
 await new Promise(r=>setTimeout(r,1500));console.log(await evaluate("document.querySelector('[role=alert]')?.textContent"));await shot('debug-avatar');await wait("!!document.querySelector('.avatar-editor img')");
 await evaluate("document.querySelector('.settings-form').requestSubmit()");await wait("!!document.querySelector('[role=status]')");
 assert.equal(await evaluate("!!document.querySelector('.profile .avatar img')"),true);await shot('account-avatar-new');
 const fill=async(selector,value)=>evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 await fill('#account-email','new-'+email);await fill('#email-password',password);
 await evaluate("document.querySelector('.email-form').requestSubmit()");
 await wait("!!document.querySelector('[role=status]')");
 await evaluate("document.querySelectorAll('[data-sidebar=content] [data-sidebar=menu-button]')[2].click()");
 await fill('#password-current',password);await fill('#password-new','new-settings-password');await fill('#password-confirm','different-password');
 await evaluate("document.querySelector('#password-current').form.requestSubmit()");await wait("!!document.querySelector('[role=alert]')");
 await fill('#password-confirm','new-settings-password');await shot('account-password-new');
 await evaluate("document.querySelector('#password-current').form.requestSubmit()");await wait("!!document.querySelector('#login-title')");
 await evaluate(`document.querySelector('#email').value=${JSON.stringify('new-'+email)};document.querySelector('#password').value='new-settings-password';document.querySelector('form').requestSubmit()`);
 await wait("!!document.querySelector('.profile .avatar img')");
 await evaluate(`document.querySelector('.profile button:last-child').click()`);await wait("!!document.querySelector('#account-avatar')");
 assert.equal(await evaluate("document.querySelector('#account-email').value"),'new-'+email);
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});await shot('account-mobile-new');
 assert.equal(await evaluate("document.querySelector('.account-modal').scrollWidth<=document.querySelector('.account-modal').clientWidth"),true);
 console.log('PASS: avatar persistence, email, password validation/change, new credentials login, mobile layout.');

} finally {ws?.close();chrome.kill();await new Promise(r=>server.httpServer.close(r))}


