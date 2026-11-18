// Real loopback API and browser, isolated database. Run from app/ after building mines-server.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {build,preview as vitePreview} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
const stamp=Date.now(),root=process.cwd(),output=join(process.env.STICKER_QA_DIR||join(root,'testsfixturesui-qa','sticker-catalog'),`run-${stamp}`);
const backendURL='http://127.0.0.1:4546',ui='http://127.0.0.1:4547',debug='http://127.0.0.1:9547';
const Q=s=>`document.querySelector(${JSON.stringify(s)})`;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(fn,label){for(let i=0;i<160;i++){try{const value=await fn();if(value)return value}catch{}await pause(100)}throw Error('Timeout: '+label)}
function portFree(port){return import('node:net').then(({createServer})=>new Promise((resolve,reject)=>{const s=createServer();s.once('error',reject);s.listen(port,'127.0.0.1',()=>s.close(resolve))}))}
mkdirSync(output,{recursive:true});
let backend,chrome,server,ws,send,ev;
async function api(op,fields={}){const result=await ev(`fetch('/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify({op,...fields})})}).then(r=>r.json())`);assert.ok(!result.error,`${op}: ${result.error}`);return result.data}
async function dom(expr){await wait(()=>ev(expr),expr)}
async function click(selector){await dom(`!!${Q(selector)}&&!${Q(selector)}.disabled`);await ev(`${Q(selector)}.click()`)}
try{
 for(const port of [4546,4547,9547])await portFree(port);
 backend=spawn(process.env.MINES_SERVER_BIN||join(root,'target/debug/mines-server'+(process.platform==='win32'?'.exe':'')),[],{stdio:'ignore',env:{...process.env,MINES_BIND:'127.0.0.1:4546',MINES_DATA_DIR:join(output,'db')}});
 await wait(async()=>(await fetch(backendURL+'/health')).ok,'real backend');
 const outDir=join(output,'dist');
 await build({configFile:false,plugins:[react(),tailwindcss()],resolve:{alias:{'@':join(root,'ui')}},build:{outDir,reportCompressedSize:false}});
 server=await vitePreview({configFile:false,build:{outDir},preview:{host:'127.0.0.1',port:4547,strictPort:true,proxy:{'/api':backendURL}}});
 chrome=spawn(process.env.CHROME_BIN||'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-sandbox','--disable-gpu','--no-first-run','--remote-debugging-port=9547','--user-data-dir='+join(output,'chrome'),'about:blank'],{stdio:'ignore'});
 const page=await wait(async()=>(await (await fetch(debug+'/json')).json()).find(p=>p.type==='page'),'Chrome');
 ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true})});
 let seq=0;const pending=new Map();ws.addEventListener('message',e=>{const reply=JSON.parse(e.data);const request=pending.get(reply.id);if(request){pending.delete(reply.id);reply.error?request.reject(Error(reply.error.message)):request.resolve(reply.result)}});
 send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method))},12000);pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value)},reject:error=>{clearTimeout(timer);reject(error)}});ws.send(JSON.stringify({id,method,params}))});
 ev=async expression=>{const reply=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(reply.exceptionDetails)throw Error(JSON.stringify(reply.exceptionDetails));return reply.result.value};
 await send('Page.enable');await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:ui+'/#login'});await dom(`!!${Q('#email')}`);
 const email=`sticker-guest-${stamp}@local.test`,password=`Test-media-${stamp}!`;
 await api('register',{email,password,name:'Тестовый профиль'});await api('login',{email,password});await send('Page.reload');await dom(`!!${Q('.profile-name strong')}`);
  const guest=(await api('state')).me;
  const ownerEmail=`sticker-owner-${stamp}@local.test`;
  await api('logout');await api('register',{email:ownerEmail,password,name:'Sticker owner'});await api('login',{email:ownerEmail,password});
  const chat=await api('create_dialog',{members:[guest.id]});
  const image=await ev(`(()=>{const c=document.createElement('canvas');c.width=c.height=64;c.getContext('2d').fillRect(0,0,64,64);return c.toDataURL()})()`);
  for(const pack of ['Private QA','Public QA'])await api('import_sticker_pack',{pack,stickers:[{name:pack,image}]});
  const ownerState=await api('state',{sticker_assets:true});
  const packs=Object.fromEntries(ownerState.stickers.map(sticker=>[sticker.pack,sticker]));
  const published=packs['Public QA'];
  const publish=async(publicValue)=>api('set_sticker_pack_public',{pack:published.pack,packId:published.packId,public:publicValue});
  await publish(true);
  for(const sticker of Object.values(packs))await api('message',{channel:chat.id,sticker:sticker.id});
  await api('logout');await api('login',{email,password});await send('Page.reload');await dom(`!!${Q('.profile-name strong')}`);
  await dom("[...document.querySelectorAll('button')].some(e=>e.textContent.includes('Sticker owner'))");
  await ev("[...document.querySelectorAll('button')].find(e=>e.textContent.includes('Sticker owner')).click()");
  const imageSelector=pack=>`.sent-sticker[alt="${pack}"]`;
  const publicImage=imageSelector('Public QA'),privateImage=imageSelector('Private QA'),preview='.sticker-preview-dialog';
  await dom(`!!${Q(publicImage)}&&!!${Q(privateImage)}`);
  assert.equal(await ev(`!!${Q(privateImage)}.closest('button')`),false);
  await click(privateImage);assert.equal(await ev(`!!${Q(preview)}`),false);
  await click('[title="Настройки пользователя"]');
   const byText=(selector,text)=>`[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.trim()===${JSON.stringify(text)})`;
   async function clickText(selector,text){
    const button=byText(selector,text);await dom(`!!(${button})&&!(${button}).disabled`);
    const point=await ev(`(()=>{const button=${button};button.scrollIntoView({block:'nearest'});const {x,y,width,height}=button.getBoundingClientRect();return {x:x+width/2,y:y+height/2}})()`);
    await wait(()=>ev(`(${button}).contains(document.elementFromPoint(${point.x},${point.y}))`),`pointer reaches ${text}`);
    await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
   }
   await clickText('.settings-sidebar nav button','Стикеры');
   await clickText('.account-modal button','Открыть коллекцию');
   const collection='.sticker-collection-modal';
   await dom(`!!${Q(`${collection} [role=tab][aria-selected=true]`)}&&${Q(`${collection} [role=tab][aria-selected=true]`)}.textContent==='Личное'`);
   await clickText(`${collection} button`,'Добавить свой набор');
   await dom(`!!${Q(`${collection} input[type=file]`)}`);
   await clickText(`${collection} button`,'Назад к наборам');
   await clickText(`${collection} [role=tab]`,'Общее');
   const publicTile=`${collection} .public-sticker-catalog button.sticker-collection-tile`;
   await dom(`!!${Q(publicTile)}&&${Q(publicTile)}.textContent.includes('Public QA')`);
   assert.equal(await ev(`${Q('.public-sticker-catalog')}.textContent.includes('Private QA')`),false);
   await click(publicTile);
   await click(`${preview}>button`);
   await dom(`!${Q(preview)}&&${Q(publicTile)}.textContent.includes('Добавлен')`);
   await clickText(`${collection} [role=tab]`,'Личное');
   await click(`${collection} summary`);
   await clickText(`${collection} button`,'Убрать из моих стикеров');
   await dom(`!${Q(`${collection} summary`)}`);
   await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
   await dom(`!${Q(collection)}&&document.activeElement===(${byText('.account-modal button','Открыть коллекцию')})`);
   await click('[aria-label="Закрыть настройки"]');
   await dom(`!!${Q(`button ${publicImage}`)}`);
   await click(`${publicImage}`);await dom(`!!${Q(preview)}&&${Q(preview)}.textContent.includes('Public QA')`);
  await dom(`!!${Q(`${preview} .sticker-grid img`)}&&${Q(`${preview} .sticker-grid img`)}.naturalWidth>0`);
  await click(`${preview}>button`);await dom(`!${Q(preview)}&&!!${Q(publicImage)}&&!${Q(publicImage)}.closest('button')`);
  await click(publicImage);assert.equal(await ev(`!!${Q(preview)}`),false);
  await click('[title="Стикеры"]');await dom(`!!${Q('.expression-panel img[alt="Public QA"]')}`);
  assert.equal(await ev(`!!${Q('.expression-panel img[alt="Private QA"]')}`),false);
  assert.ok((await api('state',{sticker_assets:true})).stickers.some(s=>s.packId===published.packId&&s.packInstalled));
  console.log('Browser: private and installed stickers are inert; public sticker previews, loads art, installs, and becomes available in the personal picker.');
 }finally{ws?.close();chrome?.kill();await server?.close();backend?.kill()}