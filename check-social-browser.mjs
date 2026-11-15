import {preview} from 'vite';
import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
process.env.MINES_DATA_DIR=process.cwd()+'/social-qa/data-'+Date.now();
mkdirSync('social-qa',{recursive:true});
const server=await preview({preview:{host:'127.0.0.1',port:4193,strictPort:true}});
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-sandbox','--disable-gpu','--no-first-run','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required','--remote-debugging-port=9334','--user-data-dir='+process.cwd()+'/social-qa/browser-profile','about:blank'],{windowsHide:true,stdio:'ignore'});
const sockets=[];
async function connect(url){const ws=new WebSocket(url);sockets.push(ws);await new Promise(r=>ws.addEventListener('open',r,{once:true}));let id=0;const pending=new Map();ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(pending.has(m.id)){const [resolve,reject]=pending.get(m.id);pending.delete(m.id);m.error?reject(m.error):resolve(m.result)}});const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,[resolve,reject]);ws.send(JSON.stringify({id:n,method,params}))});const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value};const wait=async expression=>{for(let i=0;i<160;i++){if(await ev(expression))return;await new Promise(r=>setTimeout(r,100))}throw new Error('Timeout '+expression+' '+await ev('document.body.innerText'))};await send('Page.enable');await send('Page.addScriptToEvaluateOnNewDocument',{source:`window.pcs=[];window.media=[];const Original=window.RTCPeerConnection;window.RTCPeerConnection=class extends Original{constructor(...args){super(...args);window.pcs.push(this)}};const gum=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async(...args)=>{const s=await gum(...args);window.media.push(s);return s}`});return {send,ev,wait};}
try{
 let pages;for(let i=0;i<80;i++){try{pages=await(await fetch('http://127.0.0.1:9334/json')).json();break}catch{await new Promise(r=>setTimeout(r,100))}}
 const a=await connect(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
 await a.send('Emulation.setDeviceMetricsOverride',{width:1920,height:1028,deviceScaleFactor:1,mobile:false});
 await a.send('Page.navigate',{url:'http://127.0.0.1:4193/#login'});await a.wait("!!document.querySelector('#email')");
 await a.ev("fetch('/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'me'})}).then(r=>r.json())");
 const text=readFileSync(process.env.MINES_DATA_DIR+'/FIRST-USER.txt','utf8');const email=text.match(/Email: (.+)/)[1].trim(),password=text.match(/Password: (.+)/)[1].trim();
 await a.ev(`document.querySelector('#email').value=${JSON.stringify(email)};document.querySelector('#password').value=${JSON.stringify(password)};document.querySelector('form').requestSubmit()`);await a.wait("!!document.querySelector('.profile-name strong')");
 const shot=async(name)=>{await a.ev('document.fonts.ready');const result=await a.send('Page.captureScreenshot',{format:'png'});writeFileSync('social-qa/'+name+'.png',Buffer.from(result.data,'base64'))};
 await shot('chat-empty');
 assert.equal(await a.ev("document.querySelectorAll('.welcome').length"),0);
 const request=async(op,data={})=>a.ev(`fetch('/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify({op,...data})})}).then(r=>r.json()).then(r=>{if(r.error)throw new Error(r.error);return r.data})`);
 const state=await request('state');const group=state.groups[0];const channel=group.channels.find(c=>c.name==='games').id;
 await a.ev(`[...document.querySelectorAll('.server-rail button')].find(b=>b.title===${JSON.stringify(group.name)}).click()`);
 await a.wait("[...document.querySelectorAll('.channel')].some(b=>b.textContent==='games')");
 await a.ev("[...document.querySelectorAll('.channel')].find(b=>b.textContent==='games').click()");
 await a.wait("!!document.querySelector('.composer')");
 await a.ev("document.querySelector('[title=\"Эмодзи\"]').click()");await a.wait("!!document.querySelector('.emoji-grid')");await a.ev("document.querySelector('.emoji-grid button').click()");await a.ev("document.querySelector('.composer').requestSubmit()");await a.wait("!!document.querySelector('.chat-message')");
 await a.ev("document.querySelector('[title=\"Добавить реакцию\"]').click()");await a.ev("document.querySelector('.reaction-picker button').click()");await a.wait("!!document.querySelector('.reactions>button')");
 const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==';
 // Create a visible sticker through browser canvas; artwork is only a test fixture.
 const stickerImage=await a.ev(`(()=>{const c=document.createElement('canvas');c.width=c.height=256;const x=c.getContext('2d');x.fillStyle='#8188ec';x.beginPath();x.arc(128,128,110,0,Math.PI*2);x.fill();x.font='130px Arial';x.textAlign='center';x.fillText('👋',128,174);return c.toDataURL()})()`);
 await request('create_sticker',{name:'Привет',image:stickerImage});await a.ev("document.querySelector('[title=\"Стикеры\"]').click()");await a.wait("!!document.querySelector('.sticker-grid button')");await a.ev("document.querySelector('.sticker-grid button').click()");await a.wait("!!document.querySelector('.sent-sticker')");
 let guestCookie='';async function guest(op,data={}){const r=await fetch('http://127.0.0.1:4193/api',{method:'POST',headers:{'Content-Type':'application/json',Cookie:guestCookie},body:JSON.stringify({op,...data})});if(r.headers.get('set-cookie'))guestCookie=r.headers.get('set-cookie').split(';')[0];const result=await r.json();assert.ok(!result.error,result.error);return result.data}
 const guestEmail=`qa-${Date.now()}@test.local`;
 const other=await guest('register',{name:'Александра',email:guestEmail,password:'qa-strong-password'});
 assert.deepEqual((await guest('state')).groups,[]);
 await a.ev("[...document.querySelectorAll('.channel')].find(b=>b.textContent==='Пригласить участников').click()");
 await a.wait("!!document.querySelector('#invite-email')");
 await a.ev(`(()=>{const field=document.querySelector('#invite-email');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,${JSON.stringify(guestEmail.toUpperCase())});field.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 await a.ev("document.querySelector('.group-modal').requestSubmit()");
 await a.wait("!document.querySelector('.group-modal') && document.body.innerText.includes('Участник добавлен в группу')");
 assert.ok((await guest('state')).groups.some(g=>g.id===group.id));
 await guest('message',{channel,text:'Привет! Теперь у нашей комнаты есть свой чат.'});
 await a.wait("document.body.innerText.includes('Теперь у нашей комнаты')");
 const message=(await guest('state')).messages.find(m=>m.user===state.me.id);assert.ok(message);await guest('reaction',{message:message.id,emoji:'❤️'});await a.wait("document.querySelector('.reactions').innerText.includes('❤️')");await shot('chat');
 await request('friend_request',{user:other.user.id});const f=(await guest('state')).friends[0];await guest('friend_accept',{id:f.id});
 await a.ev("document.querySelector('[title=\"Боты комнаты\"]').click()");await a.wait("!!document.querySelector('.bot-settings')");await shot('bots');await a.ev("[...document.querySelectorAll('.group-modal button')].find(b=>b.textContent==='Закрыть').click()");
 const bot=await request('create_bot',{channel,name:'Помощник'});let r=await fetch('http://127.0.0.1:4193/api',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${bot.token}`},body:JSON.stringify({op:'bot_message',text:'Я подключён к этой комнате.'})});assert.equal(r.status,200);await a.wait("!!document.querySelector('.bot-badge')");
 await a.ev("document.querySelector('[title=\"Настройки пользователя\"]').click()");await a.wait("!!document.querySelector('.account-modal')");await shot('settings');await a.ev("[...document.querySelectorAll('.settings-sidebar button')].find(b=>b.textContent.includes('Активные сеансы')).click()");await a.wait("!!document.querySelector('.session-row')");await shot('sessions');await a.ev("document.querySelector('[title=\"Закрыть настройки\"]').click()");
 await a.ev("document.querySelector('[title=\"Устройства ввода и вывода\"]').click()");await a.wait("!!document.querySelector('.voice-settings')");await shot('devices');await a.ev("document.querySelector('[title=\"Закрыть настройки\"]').click()");
 await a.ev("document.querySelector('.server-rail button').click()");await a.wait("!!document.querySelector('.dialog-list')");assert.ok((await request('state')).friends.some(f=>f.accepted));await shot('friends');
 // Create rooms through the UI and verify the server-selected identity.
 const fillName=async value=>a.ev(`(()=>{const input=document.querySelector('.group-modal input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}))})()`);
 await a.ev("document.querySelector('.server-rail .lucide-plus').closest('button').click()");await a.wait("!!document.querySelector('.group-modal input')");await fillName('Backend QA');await a.ev("document.querySelector('.group-modal').requestSubmit()");await a.wait("!document.querySelector('.group-modal') && document.querySelector('.channel-sidebar header strong').textContent==='Backend QA'");
 const createdGroup=(await request('state')).groups.find(g=>g.name==='Backend QA');assert.ok(createdGroup);
 await a.ev("document.querySelector('.category button').click()");await a.wait("!!document.querySelector('.group-modal input')");await fillName('planning');await a.ev("document.querySelector('.group-modal').requestSubmit()");await a.wait("!document.querySelector('.group-modal') && document.querySelector('.chat-header strong').textContent==='planning'");
 const createdChannel=(await request('state')).groups.find(g=>g.id===createdGroup.id).channels.find(c=>c.name==='planning');assert.ok(createdChannel);
 await guest('join_group',{invite:createdGroup.invite});await guest('message',{channel:createdChannel.id,text:'Persistent group message'});await a.wait("document.querySelector('.message-scroll').innerText.includes('Persistent group message')");await shot('created-group');
 const dialog=await request('create_dialog',{members:[other.user.id],name:'Private QA'});await guest('message',{channel:dialog.id,text:'Persistent private message'});
 await a.ev("document.querySelector('.server-rail button').click()");await a.wait("[...document.querySelectorAll('.dialog-row')].some(b=>b.textContent.includes('Persistent private message'))");await a.ev("[...document.querySelectorAll('.dialog-row')].find(b=>b.textContent.includes('Persistent private message')).click()");await a.wait("document.querySelector('.message-scroll').innerText.includes('Persistent private message')");await shot('dialog');
 await a.ev("[...document.querySelectorAll('.server-rail button')].find(b=>b.title==='LordDevil').click()");await a.wait("!!document.querySelector('.voice-channel button.channel')");await a.ev("document.querySelector('.voice-channel button.channel').click()");await a.wait("!!document.querySelector('.voice-stage')");await shot('voice');
 await a.send('Page.reload');await a.wait("!!document.querySelector('.profile-name strong')");assert.ok((await request('state')).stickers.length);assert.ok((await request('state')).friends[0].accepted);assert.ok((await request('state')).messages.some(m=>m.channel===dialog.id&&m.text==='Persistent private message'));
 console.log('PASS: two accounts, messages, reactions, sticker send, friends, bot HTTP, reload persistence, settings/devices and screenshots');
}finally{sockets.forEach(s=>s.close());chrome.kill();await new Promise(r=>server.httpServer.close(r))}

