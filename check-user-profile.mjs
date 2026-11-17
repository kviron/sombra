import {preview} from 'vite';
import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';

process.env.MINES_DATA_DIR=process.cwd()+'/user-qa/data-'+Date.now();
mkdirSync('user-qa',{recursive:true});
const base='http://127.0.0.1:4195';
const server=await preview({preview:{host:'127.0.0.1',port:4195,strictPort:true}});
const chromeProfile=mkdtempSync(join(tmpdir(),'sombra-user-qa-'));
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',[
 '--headless=new','--no-sandbox','--disable-gpu','--no-first-run','--disable-dev-shm-usage',
 '--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required',
 '--remote-debugging-port=9336','--user-data-dir='+chromeProfile,'about:blank',
],{windowsHide:true,stdio:'ignore'});

async function boot(){
 for(let attempt=0;attempt<80;attempt++){
  try{
   const response=await fetch(base+'/api',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"op":"me"}'});
   if((await response.text()).trim().startsWith('{'))return;
  }catch{}
  await new Promise(resolve=>setTimeout(resolve,250));
 }
 throw new Error('Backend did not start');
}
await boot();
const credentials=readFileSync(process.env.MINES_DATA_DIR+'/FIRST-USER.txt','utf8');
const owner={email:credentials.match(/Email: (.+)/)[1].trim(),password:credentials.match(/Password: (.+)/)[1].trim()};

async function call(op,data={},cookie=''){
 const response=await fetch(base+'/api',{method:'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify({op,...data})});
 const setCookie=response.headers.get('set-cookie');
 if(setCookie)cookie=setCookie.split(';')[0];
 const result=await response.json();
 if(result.error)throw new Error(op+': '+result.error);
 return {data:result.data,cookie};
}
const ownerSession=await call('login',owner);
const state=await call('state',{},ownerSession.cookie);
const group=state.data.groups[0];
const guestEmail='profile-'+Date.now()+'@test.local';
const guest=await call('register',{name:'LordDevil',email:guestEmail,password:'qa-strong-password'});
const guestCookie=guest.cookie;
const keepAlive=setInterval(()=>void call('state',{},guestCookie).catch(()=>{}),4000);
await call('invite_group_member',{group:group.id,email:guestEmail},ownerSession.cookie);
await call('create_dialog',{members:[guest.data.user.id],name:''},ownerSession.cookie);
const absentEmail='away-'+Date.now()+'@test.local';
const absentStarted=Date.now();
await call('register',{name:'Demonichka',email:absentEmail,password:'qa-strong-password'});
await call('invite_group_member',{group:group.id,email:absentEmail},ownerSession.cookie);
const games=group.channels.find(channel=>channel.name==='games');
await call('message',{channel:games.id,text:'Привет! Посмотри, как теперь выглядит профиль.'},guestCookie);

let ws;
try{
 let pages;
 for(let attempt=0;attempt<100;attempt++){try{pages=await(await fetch('http://127.0.0.1:9336/json')).json();break}catch{await new Promise(resolve=>setTimeout(resolve,100))}}
 ws=new WebSocket(pages.find(page=>page.type==='page').webSocketDebuggerUrl);
 await new Promise(resolve=>ws.addEventListener('open',resolve,{once:true}));
 let id=0;const pending=new Map();
 ws.addEventListener('message',event=>{const message=JSON.parse(event.data);if(pending.has(message.id)){const [resolve,reject]=pending.get(message.id);pending.delete(message.id);message.error?reject(message.error):resolve(message.result)}});
 const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,[resolve,reject]);ws.send(JSON.stringify({id:n,method,params}))});
 const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value};
 const wait=async (expression,tries=200)=>{for(let attempt=0;attempt<tries;attempt++){if(await evaluate(expression))return;await new Promise(resolve=>setTimeout(resolve,100))}throw new Error('Timed out: '+expression+'\n'+await evaluate('document.body.innerText'))};
 const shot=async name=>{await evaluate('document.fonts.ready');const result=await send('Page.captureScreenshot',{format:'png'});writeFileSync('user-qa/'+name+'.png',Buffer.from(result.data,'base64'))};
 const escape=async selector=>{await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await wait(`!document.querySelector(${JSON.stringify(selector)})`)};
 const closeMenu=async()=>{await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await wait("!document.querySelector('[data-slot=context-menu-content]')")};
 const rightClick=async selector=>{
  await evaluate(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});const box=element.getBoundingClientRect();element.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,clientX:box.left+20,clientY:box.top+12}));})()`);
  await wait("!!document.querySelector('[data-slot=context-menu-content]')");
 };
 const menuText=()=>evaluate("document.querySelector('[data-slot=context-menu-content]').innerText");
 const choose=async label=>{
  await evaluate(`[...document.querySelectorAll('[data-slot=context-menu-content] [role=menuitem]')].find(item=>item.textContent.trim()===${JSON.stringify(label)}).click()`);
  await wait("!document.querySelector('[data-slot=context-menu-content]')");
 };
 const ensureMembers=async()=>{
  await evaluate("[...document.querySelectorAll('.server-rail button')].find(button=>button.title==='LordDevil').click()");
  await wait("!!document.querySelector('.chat-header button[title=Участники]')");
  if(!(await evaluate("!!document.querySelector('.member-list')")))await evaluate("document.querySelector('.chat-header button[title=Участники]').click()");
  await wait("!!document.querySelector('.member-list')");
 };

 await send('Page.enable');
 await send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:base+'/#login'});
 await wait("!!document.querySelector('#email')");
 for(let attempt=0;attempt<3;attempt+=1){
  await evaluate(`document.querySelector('#email').value=${JSON.stringify(owner.email)};document.querySelector('#password').value=${JSON.stringify(owner.password)};document.querySelector('form').requestSubmit()`);
  try{await wait("!!document.querySelector('.profile-name strong') && document.querySelector('.profile-name strong').textContent.trim()!=='Загрузка…'",80);break}
  catch(error){if(attempt===2)throw error;await new Promise(resolve=>setTimeout(resolve,1500))}
 }

 // Each audio control owns a separate quick-settings popover.
 for(const [label,kind] of [['Быстрые настройки микрофона','input'],['Быстрые настройки наушников','output']]){
  await evaluate(`document.querySelector('button[aria-label="${label}"]').click()`);
  await wait(`!!document.querySelector('#quick-${kind}-device')`);
  await wait("document.querySelectorAll('.voice-quick-panel [role=slider]').length===1");
  assert.equal(await evaluate("document.querySelectorAll('.voice-quick-panel [role=slider]').length"),1);
  await evaluate("document.querySelector('.voice-quick-panel [role=slider]').dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true,cancelable:true}))");
  await wait("document.querySelector('.voice-quick-panel output').textContent==='0%'");
  await evaluate("document.querySelector('.voice-quick-panel [role=slider]').dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true,cancelable:true}))");
  await wait(`document.querySelector('.voice-quick-panel output').textContent==='${kind==='input'?200:100}%'`);
  await evaluate(`document.querySelector('#quick-${kind}-device').click()`);
  await wait("!!document.querySelector('[role=option]')");
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await escape('.voice-quick-panel');
 }

 // Friends entry opens the existing friends, pending requests and add-person screen.
 await evaluate("document.querySelector('.friends-nav').click()");
 await wait("!!document.querySelector('.friends-page')");
 assert.equal(await evaluate("document.querySelector('.chat-header strong').textContent.trim()"),'Друзья');
 assert.equal(await evaluate("document.querySelectorAll('.friends-page nav button').length"),3);
 assert.equal(await evaluate("!!document.querySelector('.composer')"),false);
 await shot('friends-page');
 await evaluate("document.querySelector('.server-rail button').click()");
 await wait("!document.querySelector('.friends-page')");

 // Direct messages use the shared avatar row with a live presence dot.
 await wait("document.querySelectorAll('.dialog-row').length===1",80);
 assert.equal(await evaluate("document.querySelectorAll('.dialog-row').length"),1,'one direct conversation');
 assert.equal(await evaluate("document.querySelector('.dialog-row .user-avatar .user-presence').dataset.online"),'true','direct message row is online');
 assert.equal(await evaluate("document.querySelector('.profile-self .avatar span').dataset.online"),'true','sidebar account chip is online');
 await shot('dialogs');

 // Members panel: one row per account, grouped by presence.
 await ensureMembers();
 await wait("document.querySelectorAll('.member-list .user-row').length===3");
 assert.equal(await evaluate("document.querySelectorAll('.member-list .user-avatar img').length"),0,'initials fall back to a letter avatar');
 await shot('members');
 const guestRow=".member-list .user-row[title='LordDevil']";
 assert.equal(await evaluate("!!document.querySelector('.member-list .user-row .user-presence')"),true,'member rows show presence');

 // The same context menu is available on a member row.
 await rightClick(guestRow);
 const menu=await menuText();
 for(const label of ['Профиль','Личное сообщение','Добавить в друзья'])assert.ok(menu.includes(label),'member menu includes '+label);
 await shot('member-menu');
 await choose('Профиль');
 await wait("!!document.querySelector('.user-profile')");
 const profile=await evaluate("document.querySelector('.user-profile').innerText");
 for(const label of ['LordDevil','В сети'])assert.ok(profile.includes(label),'profile shows '+label);
 assert.ok(profile.toLowerCase().includes('общие группы'),'profile shows shared groups');
 assert.equal(await evaluate("document.querySelectorAll('.user-profile-groups li').length"),1,'shared group is listed');
 assert.ok((await evaluate("document.querySelector('.user-profile-bio').textContent")).length>0);
 await shot('profile');

 // A note is personal and survives closing the card.
 await evaluate(`(()=>{const field=document.querySelector('.user-profile-note textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(field,'Тимлид, часовой пояс +3');field.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 assert.equal(await evaluate("Object.keys(localStorage).some(key=>key.startsWith('sombra-profile-note:'))"),true,'note is stored locally');
 await escape('.user-profile');
 await rightClick(guestRow);
 await choose('Профиль');
 await wait("!!document.querySelector('.user-profile')");
 assert.equal(await evaluate("document.querySelector('.user-profile-note textarea').value"),'Тимлид, часовой пояс +3','note is restored');
 await escape('.user-profile');

 // A shared group in the profile opens that group.
 await rightClick(guestRow);
 await choose('Профиль');
 await wait("!!document.querySelector('.user-profile')");
 await evaluate("document.querySelector('.user-profile-groups li button').click()");
 await wait("!document.querySelector('.user-profile')");
 assert.equal(await evaluate("document.querySelector('.server-rail .server.active').title"),'LordDevil','profile group link selects the group');

 // The account row opens its own card; editing goes to account settings.
 await ensureMembers();
 await rightClick(".member-list .user-row[title='HollyWood']");
 const selfMenu=await menuText();
 assert.ok(selfMenu.includes('Изменить профиль'));
 assert.equal(selfMenu.includes('Личное сообщение'),false);
 await closeMenu();
 await evaluate("document.querySelector('.profile-self').click()");
 await wait("!!document.querySelector('.user-profile')");
 assert.ok((await evaluate("document.querySelector('.user-profile').innerText")).includes('Это вы'));
 await evaluate("document.querySelector('.user-profile-primary').click()");
 await wait("!!document.querySelector('[role=dialog][aria-label=\"Учётная запись\"]')");
 await escape('[role=dialog][aria-label="Учётная запись"]');

 // «Личное сообщение» creates or selects a direct conversation.
 await ensureMembers();
 await rightClick(guestRow);
 await choose('Личное сообщение');
 await wait("document.querySelector('.chat-header strong').textContent.trim()==='LordDevil'");
 assert.equal(await evaluate("!!document.querySelector('.dialog-row.selected')"),true,'direct conversation is selected');
 assert.equal(await evaluate("document.querySelector('.chat-header-user').textContent.trim()==='LordDevil'"),true,'direct message header names the person');
 await shot('direct-message');

 // Clicking the person in the header opens the same card.
 await evaluate("document.querySelector('.chat-header-user').click()");
 await wait("!!document.querySelector('.user-profile')");
 await shot('profile-from-header');
 await escape('.user-profile');

 // The direct message row menu offers the profile too.
 await rightClick('.dialog-row.selected');
 assert.ok((await menuText()).includes('Профиль'));
 await choose('Профиль');
 await wait("!!document.querySelector('.user-profile')");
 await escape('.user-profile');

 // Message authors lead to the profile card.
 await ensureMembers();
 await evaluate("[...document.querySelectorAll('.channel')].find(button=>button.textContent.trim()==='games').click()");
 await wait("!!document.querySelector('.chat-message .avatar-trigger')");
 await evaluate("document.querySelector('.chat-message .avatar-trigger').click()");
 await wait("!!document.querySelector('.user-profile') && document.querySelector('.user-profile').innerText.includes('LordDevil')");
 await shot('profile-from-message');
 await escape('.user-profile');

 // Voice participants keep the avatar, meter and the shared menu.
 await evaluate("(()=>{const channel=[...document.querySelectorAll('.channel')].find(button=>button.textContent.trim()==='Команда 2');channel.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));})()");
 await wait("document.querySelectorAll('.voice-channel-participant').length>=1");
 assert.equal(await evaluate("!!document.querySelector('.voice-channel-participant .user-avatar .user-presence')"),true,'voice row has a presence dot');
 assert.equal(await evaluate("!!document.querySelector('.voice-channel-participant [role=meter]')"),true,'voice row keeps the level meter');
 assert.equal(await evaluate("!!document.querySelector('.voice-tile .user-avatar')"),true,'voice tile reuses the avatar');
 await shot('voice');
 await rightClick('.voice-channel-participant:has(small)');
 assert.ok((await menuText()).includes('Профиль'));
 await closeMenu();

 // Presence expires for accounts that stop polling.
 console.log('waiting for presence TTL');
 await new Promise(resolve=>setTimeout(resolve,Math.max(0,absentStarted+48000-Date.now())));
 await ensureMembers();
 await wait("document.querySelector('.member-list').innerText.toUpperCase().includes('НЕ В СЕТИ')",600);
 await wait("[...document.querySelectorAll('.member-list .user-row[title=\"Demonichka\"] .user-presence')].every(dot=>dot.dataset.online==='false')",600);
 assert.equal(await evaluate("document.querySelector('.member-list h3').textContent.trim()"),'В сети — 2','offline accounts move to the other group');
 await shot('offline-members');
 await rightClick(".member-list .user-row[title='Demonichka']");
 await choose('Профиль');
 await wait("!!document.querySelector('.user-profile')");
 assert.ok((await evaluate("document.querySelector('.user-profile').innerText")).includes('Не в сети'));
 assert.ok((await evaluate("document.querySelector('.user-profile-last')?.textContent||''")).length>1,'offline card shows the last seen moment');
 await shot('offline-profile');
 await escape('.user-profile');

 // The card scrolls inside a small window instead of leaving the viewport.
 await send('Emulation.setDeviceMetricsOverride',{width:720,height:520,deviceScaleFactor:1,mobile:false});
 await evaluate("document.querySelector('.server-rail button').click()");
 await wait("!!document.querySelector('.dialog-row')");
 await rightClick('.dialog-row');
 await choose('Профиль');
 await wait("!!document.querySelector('.user-profile')");
 const bounds=await evaluate("(()=>{const box=document.querySelector('.user-profile').getBoundingClientRect();return {top:box.top,bottom:box.bottom,height:box.height,scroll:document.querySelector('.user-profile').scrollHeight}})()");
 assert.ok(bounds.top>=32&&bounds.bottom<=520,`profile stays inside the window: ${JSON.stringify(bounds)}`);
 assert.ok(bounds.scroll>bounds.height,'profile content scrolls in a small window');
 await shot('profile-narrow');

 console.log('PASS: shared user rows, presence dots, user context menu, direct messages and profile card.');
}finally{
 clearInterval(keepAlive);
 ws?.close();
 chrome.kill();
 await new Promise(resolve=>server.httpServer.close(resolve));
}
