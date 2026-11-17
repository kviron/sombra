import {preview} from 'vite';
import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
const stamp=Date.now(), output=`dialog-calls-qa/run-${stamp}`, backendPort=4389, uiPort=4197, debugPort=9337;
mkdirSync(output,{recursive:true});
const dataDir=process.cwd()+`/${output}/data`;
const backend=spawn(process.cwd()+'/target/debug/mines-chat.exe',['--backend'],{windowsHide:true,stdio:'ignore',env:{...process.env,MINES_DATA_DIR:dataDir,MINES_BIND:`127.0.0.1:${backendPort}`}});
const sockets=[];let server,chrome;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,label){for(let i=0;i<240;i++){try{const value=await fn();if(value)return value}catch{}await pause(100)}throw Error('Timeout: '+label)}
function fixtures(){
 window.pcs=[]; window.streams=[];window.pageErrors=[];
 window.addEventListener('error',event=>window.pageErrors.push(String(event.message)));
 window.addEventListener('unhandledrejection',event=>window.pageErrors.push(String(event.reason?.message||event.reason)));
 // Retain ringtone references: cleanup removes src before assertions can inspect it.
 window.ringtoneElements=[];window.ringtoneEvents=[];
 const mediaPlay=HTMLMediaElement.prototype.play,mediaPause=HTMLMediaElement.prototype.pause;
 const isRingtone=media=>window.ringtoneElements.includes(media)||/call-ringtone[^/]*\.wav(?:[?#]|$)/.test(media.currentSrc||media.src);
 HTMLMediaElement.prototype.play=function(...args){
  if(isRingtone(this)){if(!window.ringtoneElements.includes(this))window.ringtoneElements.push(this);window.ringtoneEvents.push({type:'play',loop:this.loop});}
  return mediaPlay.apply(this,args);
 };
 HTMLMediaElement.prototype.pause=function(...args){
  if(isRingtone(this))window.ringtoneEvents.push({type:'pause',index:window.ringtoneElements.indexOf(this)});
  return mediaPause.apply(this,args);
 };
 const Peer=window.RTCPeerConnection;window.RTCPeerConnection=class extends Peer{constructor(config){super(config);window.pcs.push(this)}};
 const capture=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
 navigator.mediaDevices.getUserMedia=async constraints=>{const stream=await capture(constraints);window.streams.push(stream);return stream};
}
async function connect(url,install=true){
 const ws=new WebSocket(url);sockets.push(ws);await new Promise(resolve=>ws.addEventListener('open',resolve,{once:true}));
 let next=0;const pending=new Map();ws.addEventListener('message',event=>{const m=JSON.parse(event.data);if(pending.has(m.id)){const [resolve,reject]=pending.get(m.id);pending.delete(m.id);m.error?reject(Error(JSON.stringify(m.error))):resolve(m.result)}});
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,[resolve,reject]);ws.send(JSON.stringify({id,method,params}))});
 const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
 const wait=async expression=>{try{return await until(()=>ev(expression),expression)}catch(e){throw Error(e.message+'\n'+await ev('JSON.stringify({body:document.body.innerText,errors:window.pageErrors,url:location.href})'))}};
 if(install){await send('Page.enable');await send('Page.addScriptToEvaluateOnNewDocument',{source:`(${fixtures.toString()})()`});await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false})}
 return {send,ev,wait};
}
const api=async(tab,body,check=true)=>{const reply=await tab.ev(`fetch('/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify(body)})}).then(r=>r.json())`);if(check)assert.ok(!reply.error,JSON.stringify(reply));return reply.data??reply};
async function click(tab,expression){await tab.wait(`!!(${expression})`);const {x,y}=await tab.ev(`(()=>{const el=${expression};el.scrollIntoView({block:'nearest'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);await tab.send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});await tab.send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1})}
const button=(text,scope='document')=>`[...${scope}.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)})`;
const shot=async(tab,name)=>{await tab.ev('document.fonts.ready');const result=await tab.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${output}/${name}.png`,Buffer.from(result.data,'base64'))};
async function refresh(tab){await tab.send('Page.reload');await tab.wait("!!document.querySelector('.profile-name strong')")}
async function openDialog(tab,name){await click(tab,"document.querySelector('.server-rail [title=\"Личные сообщения\"]')");await click(tab,`[...document.querySelectorAll('.dialog-row')].find(e=>e.textContent.includes(${JSON.stringify(name)}))`);await tab.wait("!!document.querySelector('[aria-label=\"Начать аудиозвонок\"]')")}
const livePeers=`pcs.filter(p=>p.connectionState==='connected').length`;
const ringtoneStarts="ringtoneEvents.filter(e=>e.type==='play').length";
async function ringing(tab){await tab.wait("ringtoneElements.some(a=>a.loop&&!a.paused&&a.readyState>=2)&&ringtoneEvents.some(e=>e.type==='play'&&e.loop)")}
async function ringtoneStopped(tab){await tab.wait("ringtoneElements.length>0&&ringtoneElements.every((a,i)=>a.paused&&!a.hasAttribute('src')&&ringtoneEvents.some(e=>e.type==='pause'&&e.index===i))")}
const ringtoneEvidence=[];
try{
 await until(async()=>{const r=await fetch(`http://127.0.0.1:${backendPort}/health`);return r.ok},'isolated backend');
 server=await preview({configFile:false,build:{outDir:process.env.SOMBRA_DIALOG_TEST_DIST||'dist'},preview:{host:'127.0.0.1',port:uiPort,strictPort:true,proxy:{'/api':`http://127.0.0.1:${backendPort}`}}});
 chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-sandbox','--disable-gpu','--no-first-run','--autoplay-policy=no-user-gesture-required','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',`--remote-debugging-port=${debugPort}`,'--user-data-dir='+process.cwd()+`/${output}/browser`,'about:blank'],{windowsHide:true,stdio:'ignore'});
 const version=await until(async()=>await(await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json(),'Chrome CDP');const browser=await connect(version.webSocketDebuggerUrl,false);
 const tabs=[];
 for(let i=0;i<3;i++){const {browserContextId}=await browser.send('Target.createBrowserContext');const {targetId}=await browser.send('Target.createTarget',{url:'about:blank',browserContextId});const pages=await(await fetch(`http://127.0.0.1:${debugPort}/json`)).json();const tab=await connect(pages.find(p=>p.id===targetId).webSocketDebuggerUrl);tabs.push(tab);await tab.send('Page.navigate',{url:`http://127.0.0.1:${uiPort}/#login`});await tab.wait("!!document.querySelector('#email')")}
 const [a,b,c]=tabs;const text=readFileSync(dataDir+'/FIRST-USER.txt','utf8');const email=text.match(/Email: (.+)/)[1].trim(),password=text.match(/Password: (.+)/)[1].trim();
 await api(a,{op:'login',email,password});
 const bLogin=await api(b,{op:'register',name:'QA Bob',email:'bob@dialog-qa.local',password:'dialog-qa-password'});
 const cLogin=await api(c,{op:'register',name:'QA Carol',email:'carol@dialog-qa.local',password:'dialog-qa-password'});
 const owner=(await api(a,{op:'me'})).user;const initial=await api(a,{op:'state'});const group=initial.groups[0];
 await api(a,{op:'invite_group_member',group:group.id,email:'carol@dialog-qa.local'});
 await api(a,{op:'friend_request',user:bLogin.user.id});const friend=(await api(b,{op:'state'})).friends.find(f=>f.from===owner.id);await api(b,{op:'friend_accept',id:friend.id});
 for(const tab of tabs)await refresh(tab);
 await click(a,"document.querySelector('.server-rail [title=\"Личные сообщения\"]')");await click(a,"document.querySelector('.new-dialog')");await a.wait("document.querySelectorAll('.new-dialog-selection').length===2");
 assert.ok(await a.ev("document.querySelector('.new-dialog-dialog').innerText.includes('В друзьях')&&document.querySelector('.new-dialog-dialog').innerText.includes('Общая группа')"));
 await click(a,"document.querySelector('.new-dialog-person[aria-label=\"Выбрать: QA Bob\"]')");await click(a,button('Создать чат',"document.querySelector('.new-dialog-dialog')"));await a.wait("!document.querySelector('.new-dialog-dialog')&&!!document.querySelector('[aria-label=\"Начать аудиозвонок\"]')");
 const direct=(await api(a,{op:'state'})).dialogs.find(d=>d.members.length===2);assert.ok(direct);
 for(const tab of [b,c])await refresh(tab);
 await click(a,"document.querySelector('[aria-label=\"Начать аудиозвонок\"]')");await b.wait("!!document.querySelector('.incoming-dialog-call')");assert.equal(await a.ev("!!document.querySelector('.incoming-dialog-call')"),false);assert.deepEqual((await api(c,{op:'state'})).dialogCalls,[]);
 const directCall=(await api(a,{op:'state'})).dialogCalls[0];assert.ok((await api(c,{op:'voice_join',room:directCall.id,client:crypto.randomUUID()},false)).error);
 await ringing(b);assert.equal(await a.ev(ringtoneStarts),0,'outgoing caller must not ring');assert.equal(await c.ev(ringtoneStarts),0,'uninvited client must not ring');
 await shot(b,'direct-incoming');await click(b,button('Ответить',"document.querySelector('.incoming-dialog-call')"));await ringtoneStopped(b);ringtoneEvidence.push({scenario:'direct-answer',events:await b.ev('ringtoneEvents')});await a.wait(`${livePeers}===1`);await b.wait(`${livePeers}===1`);
 await shot(a,'direct-active');
 for(const tab of [a,b])await click(tab,button('Выйти',"document.querySelector('.dialog-call-banner')"));await api(a,{op:'dialog_call_cancel',call:directCall.id});
 await click(a,"document.querySelector('.new-dialog')");for(const name of ['QA Bob','QA Carol'])await click(a,`document.querySelector('.new-dialog-person[aria-label="Выбрать: ${name}"]')`);
 await a.ev(`(()=>{const el=document.querySelector('.new-dialog-name input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'QA Trio');el.dispatchEvent(new Event('input',{bubbles:true}))})()`);await shot(a,'picker-two-selected');await click(a,button('Создать группу',"document.querySelector('.new-dialog-dialog')"));await a.wait("!document.querySelector('.new-dialog-dialog')");
 const trio=(await api(a,{op:'state'})).dialogs.find(d=>d.members.length===3);assert.ok(trio);assert.equal(trio.name,'QA Trio');
 for(const tab of [b,c])await refresh(tab);
 await click(a,"document.querySelector('[aria-label=\"Начать видеозвонок\"]')");await b.wait("!!document.querySelector('.incoming-dialog-call')");await c.wait("!!document.querySelector('.incoming-dialog-call')");await shot(c,'group-incoming');
 const call=(await api(a,{op:'state'})).dialogCalls.find(call=>call.dialog===trio.id);assert.equal(call.video,true);
 await ringing(b);await ringing(c);assert.equal(await a.ev(ringtoneStarts),0,'outgoing group caller must not ring');
 await click(b,button('Отклонить',"document.querySelector('.incoming-dialog-call')"));await b.wait("!document.querySelector('.incoming-dialog-call')");await ringtoneStopped(b);const declinedStarts=await b.ev(ringtoneStarts);ringtoneEvidence.push({scenario:'group-decline',events:await b.ev('ringtoneEvents')});await click(c,button('Ответить',"document.querySelector('.incoming-dialog-call')"));await ringtoneStopped(c);ringtoneEvidence.push({scenario:'group-answer',events:await c.ev('ringtoneEvents')});
 await a.wait(`${livePeers}===1`);await c.wait(`${livePeers}===1`);await openDialog(b,'QA Trio');await b.wait("!!document.querySelector('.dialog-call-banner')");await shot(b,'declined-late-join-banner');await click(b,button('Присоединиться',"document.querySelector('.dialog-call-banner')"));
 for(const tab of tabs)await tab.wait(`${livePeers}===2`);
 await ringtoneStopped(b);assert.equal(await b.ev(ringtoneStarts),declinedStarts,'late join must not restart ringtone');assert.equal(await a.ev(ringtoneStarts),0,'caller must never play incoming ringtone');
 const received=[];
 for(const [i,tab] of tabs.entries()){
  await tab.wait("pcs.filter(p=>p.connectionState==='connected').every(p=>p.getReceivers().some(r=>r.track.kind==='video'&&!r.track.muted&&r.track.readyState==='live'))");
  await tab.wait("streams.some(s=>s.getVideoTracks().some(t=>t.readyState==='live'))");
  const stats=await tab.ev("Promise.all(pcs.filter(p=>p.connectionState==='connected').map(async p=>[...await p.getStats()].filter(([,v])=>v.type==='inbound-rtp').map(([,v])=>({kind:v.kind,bytes:v.bytesReceived}))))");received.push(stats);
  assert.ok(stats.flat().some(s=>s.kind==='audio'&&s.bytes>0));assert.ok(stats.flat().some(s=>s.kind==='video'&&s.bytes>0));await shot(tab,`trio-live-${i}`);
 }
 assert.deepEqual(new Set((await api(a,{op:'state'})).dialogCalls.find(x=>x.id===call.id).participants),new Set([owner.id,bLogin.user.id,cLogin.user.id]));
 await click(a,button('Выйти',"document.querySelector('.dialog-call-banner')"));await b.wait(`${livePeers}===1`);await c.wait(`${livePeers}===1`);
 await click(c,button('Выйти',"document.querySelector('.dialog-call-banner')"));await b.wait(`${livePeers}===0`);assert.deepEqual((await api(b,{op:'state'})).dialogCalls.find(x=>x.id===call.id).participants,[bLogin.user.id]);assert.equal(await b.ev("!!document.querySelector('.voice-status')"),true);await shot(b,'last-participant-still-active');
 await click(b,button('Выйти',"document.querySelector('.dialog-call-banner')"));const empty=(await api(a,{op:'state'})).dialogCalls.find(x=>x.id===call.id);assert.deepEqual(empty.participants,[]);assert.equal(typeof empty.empty_since,'number');
 if(process.env.SOMBRA_DIALOG_TEST_EXPIRY==='1'){await pause(61000);assert.equal((await api(a,{op:'state'})).dialogCalls.some(x=>x.id===call.id),false)}
 const result={passed:true,isolatedBackendPort:backendPort,dataDir,threeIndependentBrowserContexts:true,directAudio:true,groupVideo:true,declineAndLateJoin:true,incomingRingtoneLifecycle:true,ringtoneEvidence,leavesDoNotEndOthers:true,receivedRtp:received,expiryTest:process.env.SOMBRA_DIALOG_TEST_EXPIRY==='1'?'real 61s':'deterministic Rust tests',screenshots:output};writeFileSync(`${output}/result.json`,JSON.stringify(result,null,2));console.log('PASS',JSON.stringify(result));
}finally{sockets.forEach(s=>s.close());chrome?.kill();backend.kill();if(server)await new Promise(resolve=>server.httpServer.close(resolve))}
