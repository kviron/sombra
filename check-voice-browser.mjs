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
 await shot('chat');
 const selectRoom=`[...document.querySelectorAll('.channel')].find(e=>e.textContent.includes('Команда 1')).click()`;
 await a.ev(selectRoom);await a.wait("!!document.querySelector('.voice-stage')");await shot('room-empty');
 await a.ev("document.querySelector('.voice-controls button').click()");await a.wait("!!document.querySelector('.voice-hangup')");
 await a.wait("document.querySelectorAll('.voice-channel-participant').length===1");
 assert.equal(await a.ev("document.querySelectorAll('.voice-channel-participant [role=meter]').length"),1,'Participant must have a microphone level meter');
 await a.wait("Number(document.querySelector('[role=meter]').getAttribute('aria-valuenow'))>0");
 await a.send('Target.createTarget',{url:'about:blank'});pages=await(await fetch('http://127.0.0.1:9334/json')).json();const b=await connect(pages.find(p=>p.url==='about:blank').webSocketDebuggerUrl);
 await b.send('Page.navigate',{url:'http://127.0.0.1:4193/#chat'});await b.wait("[...document.querySelectorAll('.channel')].some(e=>e.textContent.includes('Команда 1'))");await b.ev(selectRoom);await b.wait("!!document.querySelector('.voice-controls button')");await b.ev("document.querySelector('.voice-controls button').click()");
 await a.wait("window.pcs.some(p=>p.connectionState==='connected')");await b.wait("window.pcs.some(p=>p.connectionState==='connected')");
 await a.wait("document.querySelector('.voice-stage').innerText.includes('На связи')");
 await a.ev("document.querySelector('[title=\"Включить камеру\"]').click()");await a.wait("!!document.querySelector('[title=\"Выключить камеру\"]')");
 console.log("Transceivers A",await a.ev("window.pcs.map(p=>p.getTransceivers().map(t=>({mid:t.mid,d:t.direction,c:t.currentDirection,s:t.sender.track?.kind,r:t.receiver.track.kind})))"));console.log("Transceivers B",await b.ev("window.pcs.map(p=>p.getTransceivers().map(t=>({mid:t.mid,d:t.direction,c:t.currentDirection,s:t.sender.track?.kind,r:t.receiver.track.kind})))")); await b.wait("window.pcs.some(p=>p.getReceivers().some(r=>r.track.kind==='video'&&!r.track.muted))");
 await a.wait("window.pcs.some(p=>p.getTransceivers().filter(t=>t.currentDirection===\u0027sendrecv\u0027).length===2)"); await b.wait("window.pcs.some(p=>p.getTransceivers().filter(t=>t.currentDirection===\u0027sendrecv\u0027).length===2)"); const stats=await b.ev("Promise.all(window.pcs.map(async pc=>[...await pc.getStats()].filter(([k,v])=>v.type==='inbound-rtp').map(([k,v])=>({kind:v.kind,bytes:v.bytesReceived}))))");assert.ok(stats.flat().some(s=>s.kind==='audio'&&s.bytes>0));console.log('Connected peers and receiving RTP',JSON.stringify(stats));
 await a.wait("document.querySelectorAll('.voice-channel-participant').length===2");
 console.log('Meter diagnostics',await a.ev("({meters:[...document.querySelectorAll('[role=meter]')].map(m=>m.outerHTML),contexts:window.contexts.map(c=>c.state),tracks:window.pcs.map(p=>p.getReceivers().map(r=>({kind:r.track.kind,muted:r.track.muted,state:r.track.readyState})))})"));
 await a.wait("[...document.querySelectorAll('.voice-channel-participant [role=meter]')].length===2 && [...document.querySelectorAll('.voice-channel-participant [role=meter]')].every(m=>Number(m.getAttribute('aria-valuenow'))>0)");
 await shot('room-connected');
 await a.ev("document.querySelector('.voice-controls [title=\"Выключить микрофон\"]').click()");assert.equal(await a.ev("window.media[0].getAudioTracks()[0].enabled"),false);
 await a.wait("document.querySelector('[role=meter]').getAttribute('aria-valuenow')==='0'");
 await b.wait("[...document.querySelectorAll('[role=meter]')].at(-1).getAttribute('aria-valuenow')==='0'");
 await shot('room-mic-muted');
 await a.ev("document.querySelector('.voice-controls [title=\"Включить микрофон\"]').click()");
 await a.wait("Number(document.querySelector('[role=meter]').getAttribute('aria-valuenow'))>0");
 await a.ev("document.querySelector('.voice-hangup').click()");await a.wait("window.media.every(s=>s.getTracks().every(t=>t.readyState==='ended'))");await b.wait("document.querySelector('.voice-stage').innerText.includes('Пригласите друзей')");
 assert.equal(await a.ev("document.querySelectorAll('.voice-channel-participant').length"),0);
 await b.wait("document.querySelectorAll('.voice-channel-participant').length===1");
 await a.ev("document.querySelector('[title=\"Настройки пользователя\"]').click()");await a.wait("!!document.querySelector('.account-modal')");await a.ev("[...document.querySelectorAll('.settings-sidebar button')].find(b=>b.textContent.includes('Голос и видео')).click()");await a.wait("!!document.querySelector('.voice-settings')");await shot('settings');
 await a.ev("[...document.querySelectorAll('.voice-test-actions button')].find(b=>b.textContent.includes('Проверить камеру')).click()");await a.wait("!!document.querySelector('.voice-settings video')");await shot('settings-preview');await a.ev("document.querySelector('[title=\"Закрыть настройки\"]').click()");await a.wait("window.media.every(s=>s.getTracks().every(t=>t.readyState==='ended'))");
 await b.ev("document.querySelector('.voice-hangup').click()");console.log('PASS: two peers, audio RTP, video, mute, leave, preview cleanup and screenshots');
}finally{sockets.forEach(s=>s.close());chrome.kill();await new Promise(r=>server.httpServer.close(r))}

