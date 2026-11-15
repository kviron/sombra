import {preview} from 'vite';
import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
mkdirSync('voice-qa',{recursive:true});
const server=await preview({preview:{host:'127.0.0.1',port:4193,strictPort:true}});
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-sandbox','--disable-gpu','--no-first-run','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required','--remote-debugging-port=9334','--user-data-dir='+process.cwd()+'/voice-qa/browser-profile','about:blank'],{windowsHide:true,stdio:'ignore'});
const sockets=[];
async function connect(url){const ws=new WebSocket(url);sockets.push(ws);await new Promise(r=>ws.addEventListener('open',r,{once:true}));let id=0;const pending=new Map();ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(pending.has(m.id)){const [resolve,reject]=pending.get(m.id);pending.delete(m.id);m.error?reject(m.error):resolve(m.result)}});const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,[resolve,reject]);ws.send(JSON.stringify({id:n,method,params}))});const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value};const wait=async expression=>{for(let i=0;i<160;i++){if(await ev(expression))return;await new Promise(r=>setTimeout(r,100))}throw new Error('Timeout '+expression+' '+await ev('document.body.innerText'))};await send('Page.enable');await send('Page.addScriptToEvaluateOnNewDocument',{source:`window.contexts=[];const AC=window.AudioContext;window.AudioContext=class extends AC{constructor(...args){super(...args);window.contexts.push(this)}};window.pcs=[];window.media=[];const Original=window.RTCPeerConnection;window.RTCPeerConnection=class extends Original{constructor(...args){super(...args);window.pcs.push(this)}};const gum=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async(...args)=>{const s=await gum(...args);if(args[0]?.audio){const ctx=new AC();await ctx.resume();const oscillator=ctx.createOscillator(),gain=ctx.createGain(),destination=ctx.createMediaStreamDestination();gain.gain.value=0.15;oscillator.connect(gain).connect(destination);oscillator.start();s.getAudioTracks().forEach(t=>{t.stop();s.removeTrack(t)});const track=destination.stream.getAudioTracks()[0],stop=track.stop.bind(track);track.stop=()=>{stop();oscillator.stop();void ctx.close()};s.addTrack(track)}window.media.push(s);return s}`});return {send,ev,wait};}
try{
 let pages;for(let i=0;i<80;i++){try{pages=await(await fetch('http://127.0.0.1:9334/json')).json();break}catch{await new Promise(r=>setTimeout(r,100))}}
 const a=await connect(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
 await a.send('Emulation.setDeviceMetricsOverride',{width:1920,height:1028,deviceScaleFactor:1,mobile:false});
 await a.send('Page.navigate',{url:'http://127.0.0.1:4193/#login'});await a.wait("!!document.querySelector('#email')");
 const text=readFileSync('data/FIRST-USER.txt','utf8');const email=text.match(/Email: (.+)/)[1].trim(),password=text.match(/Password: (.+)/)[1].trim();
 await a.ev(`document.querySelector('#email').value=${JSON.stringify(email)};document.querySelector('#password').value=${JSON.stringify(password)};document.querySelector('form').requestSubmit()`);await a.wait("!!document.querySelector('.profile-name strong')");
 const shot=async(name)=>{await a.ev('document.fonts.ready');const result=await a.send('Page.captureScreenshot',{format:'png'});writeFileSync('voice-qa/'+name+'.png',Buffer.from(result.data,'base64'))};

 const request=async(op,data={})=>a.ev(`fetch('/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify({op,...data})})}).then(r=>r.json()).then(r=>{if(r.error)throw new Error(r.error);return r.data})`);
 const state=await request('state');const group=state.groups[0];
 assert.equal(await a.ev("document.querySelectorAll('.channel-settings').length"),group.channels.length);
 const voiceNames=group.channels.filter(c=>c.kind==='voice').map(c=>c.name);
 assert.deepEqual(await a.ev("[...document.querySelectorAll('.voice-channel .channel > span')].map(el=>el.textContent)"),voiceNames,'Voice channel list must preserve full saved names, including emoji');
 const originalTitle=await a.ev("document.querySelector('.chat-header strong').textContent");
 for(const channel of [group.channels.find(c=>c.kind==='text'),group.channels.find(c=>c.kind==='voice')]){
  const open=`[...document.querySelectorAll('.channel-settings')].find(b=>b.getAttribute('aria-label')===${JSON.stringify('Настроить канал '+channel.name)}).click()`;
  await a.ev(open);await a.wait("!!document.querySelector('#channel-edit-name')");
  assert.equal(await a.ev("document.querySelector('.chat-header strong').textContent"),originalTitle);
  assert.equal(await a.ev("window.media.length"),0);
  const fill=async value=>a.ev(`(()=>{const input=document.querySelector('#channel-edit-name');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  await fill(channel.name+' QA');await shot('channel-settings');await a.ev("document.querySelector('.group-modal').requestSubmit()");await a.wait("!document.querySelector('.group-modal')");
  assert.equal((await request('state')).groups[0].channels.find(c=>c.id===channel.id).name,channel.name+' QA');
  await request('update_channel',{group:group.id,channel:channel.id,name:channel.name});
  await a.send('Page.reload');await a.wait("!!document.querySelector('.channel-settings')");
 }
 await shot('channels-with-settings');
 await a.ev("document.querySelector('.voice-channel .channel').click()");await a.wait("!!document.querySelector('.voice-stage')");await shot('voice-with-settings');
 console.log('PASS: every channel has settings; text and voice rename persist; settings do not navigate or join voice');
}finally{sockets.forEach(s=>s.close());chrome.kill();await new Promise(r=>server.httpServer.close(r))}
