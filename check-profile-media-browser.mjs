// Real loopback API and browser, isolated database. Run from app/ after building mines-server.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {preview} from 'vite';
const stamp=Date.now(),root=process.cwd(),output=join(root,'testsfixturesui-qa','profile-media',`run-${stamp}`);
const backendURL='http://127.0.0.1:4524',ui='http://127.0.0.1:4525',debug='http://127.0.0.1:9525';
const Q=s=>`document.querySelector(${JSON.stringify(s)})`,panel='.profile-media',modal='.profile-effects-dialog';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(fn,label){for(let i=0;i<160;i++){try{const value=await fn();if(value)return value}catch{}await pause(100)}throw Error('Timeout: '+label)}
function portFree(port){return import('node:net').then(({createServer})=>new Promise((resolve,reject)=>{const s=createServer();s.once('error',reject);s.listen(port,'127.0.0.1',()=>s.close(resolve))}))}
mkdirSync(output,{recursive:true});
let backend,chrome,server,ws,send,ev;
async function api(op,fields={}){const result=await ev(`fetch('/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify({op,...fields})})}).then(r=>r.json())`);assert.ok(!result.error,`${op}: ${result.error}`);return result.data}
async function dom(expr){await wait(()=>ev(expr),expr)}
async function click(selector){await dom(`!!${Q(selector)}&&!${Q(selector)}.disabled`);await ev(`${Q(selector)}.click()`)}
async function shot(name){await ev('document.fonts.ready.then(()=>true)');const r=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(output,name+'.png'),Buffer.from(r.data,'base64'))}
async function settings(){await click('[title="Настройки пользователя"]');await dom(`!!${Q(panel)}`)}
async function animated(selector,count){
 const pixels=`Array.from(document.querySelectorAll(${JSON.stringify(selector)}),canvas=>{const data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let hash=2166136261,lit=false;for(const value of data){hash=Math.imul(hash^value,16777619);lit||=value!==0}return lit?hash:null})`;
 const start=await wait(async()=>{const values=await ev(pixels);return values.length===count&&values.every(value=>value!==null)&&values},`painted ${selector}`);
 await wait(async()=>{const values=await ev(pixels);return values.length===count&&values.every((value,index)=>value!==null&&value!==start[index])},`autoplay ${selector}`);
}
async function file(id){const {root:doc}=await send('DOM.getDocument');const {nodeId}=await send('DOM.querySelector',{nodeId:doc.nodeId,selector:'#account-'+id});await send('DOM.setFileInputFiles',{nodeId,files:[join(root,'testsfixturesui-qa/profile-cover/grid.png')]});await dom(`!!${Q('.image-crop-apply')}&&!${Q('.image-crop-apply')}.disabled`);await click('.image-crop-apply');await dom(`!${Q('[data-image-crop-dialog]')}`)}
async function effect(target,choice,columns){
 const control=`${panel} [data-target="${target}"] [aria-haspopup="dialog"]`;
 await ev(`${Q(control)}.focus()`);await click(control);await dom(`!!${Q(modal)}`);
 for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
 await dom(`!${Q(modal)}&&!!${Q(panel)}&&document.activeElement===${Q(control)}`);
 await click(control);await dom(`!!${Q(modal)}`);
 assert.equal(await ev(`!!${Q('.profile-effect-play')}`),false);
 await animated(`${modal} .avatar-fx__canvas`,2);
 assert.equal(await ev(`getComputedStyle(${Q('.profile-effect-options')}).gridTemplateColumns.split(' ').length`),columns);
 assert.equal(await ev(`${Q(modal)}.querySelectorAll('input[type=radio]').length`),0);
 await click(`.profile-effect-card:nth-child(${choice})`);
 assert.equal(await ev(`${Q(`.profile-effect-card:nth-child(${choice})`)}.getAttribute('aria-pressed')`),'true');
 assert.deepEqual(await ev(`(()=>{const dialog=getComputedStyle(${Q(modal)}),selected=getComputedStyle(${Q('.profile-effect-card[aria-pressed=true]')});return {surface:dialog.backgroundColor,text:dialog.color,selected:selected.borderTopColor}})()`),{surface:'rgb(27, 30, 38)',text:'rgb(220, 224, 232)',selected:'rgb(174, 184, 201)'});
 await shot(target+'-picker');await click(`${modal} footer button:last-child`);await dom(`!${Q(modal)}`);await dom(`document.activeElement===${Q(control)}`);
}
try{
 for(const port of [4524,4525,9525])await portFree(port);
 backend=spawn(process.env.MINES_SERVER_BIN||join(root,'target/debug/mines-server'+(process.platform==='win32'?'.exe':'')),[],{stdio:'ignore',env:{...process.env,MINES_BIND:'127.0.0.1:4524',MINES_DATA_DIR:join(output,'db')}});
 await wait(async()=>(await fetch(backendURL+'/health')).ok,'real backend');
 server=await preview({configFile:false,build:{outDir:'dist'},preview:{host:'127.0.0.1',port:4525,strictPort:true,proxy:{'/api':backendURL}}});
 chrome=spawn(process.env.CHROME_BIN||'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-sandbox','--disable-gpu','--no-first-run','--remote-debugging-port=9525','--user-data-dir='+join(output,'chrome'),'about:blank'],{stdio:'ignore'});
 const page=await wait(async()=>(await (await fetch(debug+'/json')).json()).find(p=>p.type==='page'),'Chrome');
 ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true})});
 let seq=0;const pending=new Map();ws.addEventListener('message',e=>{const reply=JSON.parse(e.data);const request=pending.get(reply.id);if(request){pending.delete(reply.id);reply.error?request.reject(Error(reply.error.message)):request.resolve(reply.result)}});
 send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method))},12000);pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value)},reject:error=>{clearTimeout(timer);reject(error)}});ws.send(JSON.stringify({id,method,params}))});
 ev=async expression=>{const reply=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(reply.exceptionDetails)throw Error(JSON.stringify(reply.exceptionDetails));return reply.result.value};
 await send('Page.enable');await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:ui+'/#login'});await dom(`!!${Q('#email')}`);
 const email=`profile-media-${stamp}@local.test`,password=`Test-media-${stamp}!`;
 await api('register',{email,password,name:'Тестовый профиль'});await api('login',{email,password});await send('Page.reload');await dom(`!!${Q('.profile-name strong')}`);
 await settings();assert.equal(await ev(`document.querySelectorAll('#account-avatar,#account-cover').length`),2);
 assert.ok(await ev(`[...document.querySelectorAll('#account-avatar,#account-cover')].every(el=>el.hidden)`));
 await file('avatar');await file('cover');await dom(`!!${Q(`${panel} .profile-cover img`)}`);
 assert.ok(await ev(`matchMedia('(prefers-reduced-motion: reduce)').matches`));
 // Freeze automatic state polling until reload so this card can only get decorations from the save DTOs.
 await ev(`(()=>{const fetchApi=window.fetch;window.qaRestoreFetch=()=>{window.fetch=fetchApi};window.fetch=(url,options)=>{if(typeof options?.body==='string'&&JSON.parse(options.body).op==='state')return new Promise(()=>{});return fetchApi.call(window,url,options)}})()`);
 await effect('avatar',2,3);await effect('cover',2,3);
 await click('[aria-label="Закрыть настройки"]');await click('.profile-self');
 const profile='.user-profile';
 await dom(`!!${Q(`${profile} .user-profile-identity canvas[data-avatar-fx-effect="holy/divine-shield"]`)}&&!!${Q(`${profile} .user-profile-banner canvas[data-avatar-fx-effect="weather/aurora"]`)}`);
 await animated(`${profile} .avatar-fx__canvas`,2);await shot('saved-profile-autoplay');await click('[aria-label="Закрыть профиль"]');await ev('window.qaRestoreFetch()');
 let me=(await api('me')).user;assert.equal(me.decorations.avatar.layers[0].effect,'holy/divine-shield');assert.equal(me.decorations.cover.layers[0].effect,'weather/aurora');
 let state=await api('state');assert.deepEqual(state.me.decorations,me.decorations);assert.deepEqual(state.users.find(u=>u.id===me.id).decorations,me.decorations);
 await settings();await ev(`${Q(`${panel} [data-target="cover"] button`)}.focus()`);await shot('unified-settings');
 await send('Page.reload');await dom(`!!${Q('.profile-name strong')}`);await settings();await dom(`!!${Q(`${panel} [data-target="avatar"] .avatar-fx__canvas`)}&&!!${Q(`${panel} [data-target="cover"] .avatar-fx__canvas`)}`);
 await click(`${panel} [data-target="cover"] [aria-haspopup="dialog"]`);await dom(`!!${Q(modal)}`);
 assert.equal(await ev(`${Q('.profile-effect-card:nth-child(3)')}.querySelectorAll('.avatar-fx__canvas').length`),0);
 await click('.profile-effect-card:nth-child(3)');await click(`${modal} footer button:last-child`);await dom(`!${Q(modal)}`);
 me=(await api('me')).user;assert.ok(!me.decorations.cover&&me.decorations.avatar&&me.cover);
 await click(`${panel} [aria-label="Удалить обложку"]`);await dom(`!${Q(`${panel} [aria-label="Удалить обложку"]`)}`);
 await click(`${panel} [aria-label="Удалить аватар"]`);await dom(`!${Q(`${panel} [aria-label="Удалить аватар"]`)}`);
 me=(await api('me')).user;assert.ok(!me.cover&&!me.avatar&&me.decorations.avatar);
 console.log(`PASS real browser/API: crop, save/DTO without polling, reduced-motion profile and picker autoplay, both projections, reload, independent clear, focus, three-column avatar and cover pickers. Screenshots: ${output}`);
  async function switchAccount(email,password){
   await api('logout');await api('login',{email,password});await send('Page.reload');
   await dom(`!!${Q('.profile-name strong')} && ${Q('.profile-name strong')}.textContent!=='Загрузка…'`);
  }
  const guestEmail=`profile-effect-guest-${stamp}@local.test`;
  const guest=(await api('register',{email:guestEmail,password,name:'Другой участник'})).user;
  await api('login',{email,password});await send('Page.reload');
  await dom(`${Q('.profile-name strong')}?.textContent==='Тестовый профиль'`);
  await api('create_dialog',{members:[guest.id],name:''});
  const ownId=(await api('me')).user.id;
  // Stub only async draft generation. All catalog mutations and user projections below use the real API.
  await ev(`(()=>{const original=window.fetch;window.draftPolls=0;window.fetch=async(url,opts)=>{
   const body=typeof opts?.body==='string'?JSON.parse(opts.body):{};
   const reply=data=>new Response(JSON.stringify({data}),{headers:{'content-type':'application/json'}});
   if(body.op==='create_profile_effect_draft')return reply({id:'draft-qa',status:'queued'});
   if(body.op==='get_profile_effect_draft')return reply(++window.draftPolls===1?{id:'draft-qa',status:'running'}:{id:'draft-qa',status:'ready',result:{title:'Черновик QA',decoration:${JSON.stringify(me.decorations.avatar)}}});
   const response=await original.call(window,url,opts);if(body.op!=='state'||!response.ok)return response;
   return reply({...((await response.json()).data),profileEffectDraftsSupported:true});
  }})()`);
  await pause(2300);await settings();await click(`${panel} [data-target="avatar"] [aria-haspopup="dialog"]`);
  await click('.profile-effect-actions button[aria-pressed="false"]');
  await ev(`(()=>{const field=${Q('#profile-effect-prompt')};Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(field,'Огненные искры');field.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  await click('.profile-effect-form button[type="submit"]');
  await animated('.profile-effect-draft canvas',1);assert.equal(await ev('window.draftPolls'),2);
  await shot('effect-draft');await click('.profile-effect-form footer button:last-child');
  const publish='[aria-label="Опубликовать в каталоге: Черновик QA"]',unpublish='[aria-label="Скрыть из каталога: Черновик QA"]';
  await dom(`!!${Q(publish)}`);
  const item=(await api('list_profile_effects',{scope:'personal',target:'avatar'})).items.find(row=>row.title==='Черновик QA');
  assert.equal(item.public,false);assert.equal((await api('me')).user.decorationRefs?.avatar,undefined);
  await click(publish);await dom(`!!${Q(unpublish)}`);
  await click('.profile-effect-tabs button:nth-child(2)');await dom(`!!${Q(unpublish)}`);
  await animated('.profile-effect-options canvas',1);await shot('effect-catalog');
  await click('.profile-effect-card');await click(`${modal} footer button:last-child`);
  await dom(`!${Q(modal)}`);assert.equal((await api('me')).user.decorationRefs.avatar,item.id);
  await switchAccount(guestEmail,password);
  await click('.dialog-row');await click('.dm-header-info');
  const equip='.user-profile-effect-action button';
  await click(equip);await dom(`${Q(equip)}?.textContent==='Установлен'`);
  assert.equal((await api('me')).user.decorationRefs.avatar,item.id);
  await switchAccount(email,password);
  await settings();await click(`${panel} [data-target="avatar"] [aria-haspopup="dialog"]`);
  await click(unpublish);await dom(`!!${Q(publish)}`);
  await switchAccount(guestEmail,password);
  const projected=(await api('state')).users.find(row=>row.id===ownId);
  assert.ok(projected.decorations.avatar);assert.equal(projected.decorationRefs?.avatar,undefined);
  assert.equal((await api('me')).user.decorationRefs.avatar,item.id,'wearer retains their selection after unpublishing');
  await click('.dialog-row');await click('.dm-header-info');await dom(`!!${Q('.user-profile-identity canvas')}`);
  assert.equal(await ev(`!!${Q(equip)}`),false,'private reference does not produce a profile action');
  console.log('PASS two real cookie sessions: async mocked Hermes preview, real private save, publish, public-profile apply, hidden action after unpublish, retained equip.');
}catch(error){console.error(error);if(send)await shot('failure').catch(()=>{});process.exitCode=1}
finally{ws?.close();chrome?.kill();backend?.kill();if(server)await new Promise(resolve=>server.httpServer.close(resolve))}
