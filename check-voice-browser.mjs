import {preview} from 'vite';
import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
process.env.MINES_DATA_DIR??=process.cwd()+'/voice-qa/data-'+Date.now();
mkdirSync('voice-qa',{recursive:true});
const server=await preview({build:{outDir:process.env.SOMBRA_VOICE_TEST_DIST||'dist'},preview:{host:'127.0.0.1',port:4193,strictPort:true}});
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-sandbox','--disable-gpu','--no-first-run','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--remote-debugging-port=9334','--user-data-dir='+process.cwd()+'/voice-qa/browser-profile','about:blank'],{windowsHide:true,stdio:'ignore'});
const sockets=[];
const relayIce=JSON.parse(process.env.SOMBRA_QA_TURN_ICE||'null');
function installDeviceFixtures(relayIce) {
 window.voiceCues=[];
 const playMedia=HTMLMediaElement.prototype.play;
 HTMLMediaElement.prototype.play=function(){
  const cue=this.src.match(/voice-(peer-joined|left)[^/]*\.wav$/)?.[1];
  const playing=playMedia.call(this);
  if(cue)void playing.then(()=>window.voiceCues.push({cue,sink:this.sinkId}),()=>{});
  return playing;
 };
 const fetchApi=window.fetch.bind(window);
 window.fetch=(input,options)=>{
  if(input==='/api'&&JSON.parse(options?.body||'{}').op==='voice_poll'){
   if(window.failVoicePoll)return Promise.resolve(new Response(JSON.stringify({error:'Тестовое отключение'}),{status:400}));
   if(window.failNextVoicePoll){
    window.failNextVoicePoll=false;
    return Promise.resolve(new Response(null,{status:503}));
   }
  }
  return fetchApi(input,options);
 };
 window.contexts=[];
 window.playbackGains=[];
 window.noiseWorklets=[];
 window.noiseWorkletFailed=false;
 const Worklet=window.AudioWorkletNode;
 window.AudioWorkletNode=class extends Worklet{
  constructor(...args){
   super(...args);
   if(args[1].endsWith('/rnnoise')){
    window.noiseWorklets.push(this);
    this.addEventListener('processorerror',()=>{window.noiseWorkletFailed=true});
   }
  }
 };
 const Audio=window.AudioContext;
 window.AudioContext=class extends Audio{
  constructor(...args){super(...args);window.contexts.push(this)}
  createGain(){const gain=super.createGain();window.playbackGains.push(gain);return gain}
 };
 window.pcs=[];
 const Peer=window.RTCPeerConnection;
 window.RTCPeerConnection=class extends Peer{
  constructor(config){super(relayIce?{...config,iceServers:relayIce,iceTransportPolicy:'relay'}:config);window.pcs.push(this)}
 };
 const devices=navigator.mediaDevices;
 const enumerate=devices.enumerateDevices.bind(devices);
 devices.enumerateDevices=async()=>[...await enumerate(),...[
  ['audioinput','test-mic','Запасной микрофон'],
  ['audioinput','missing-mic','Недоступный микрофон'],
  ['videoinput','test-camera','Запасная камера'],
  ['audiooutput','test-speaker','Запасные динамики'],
 ].map(([kind,deviceId,label])=>({kind,deviceId,label,groupId:'test-devices'}))];
 window.media=[];
 window.audioConstraints=[];
 window.capturedTracks=[];
 window.deviceForTrack=new WeakMap();
 const capture=devices.getUserMedia.bind(devices);
 devices.getUserMedia=async constraints=>{
  if(constraints.audio)window.audioConstraints.push(constraints.audio);
  const audioId=constraints.audio?.deviceId?.exact;
  const videoId=constraints.video?.deviceId?.exact;
  if(audioId==='missing-mic')throw new DOMException('Missing device','NotFoundError');
  // Chrome supplies one fake device per input. Reuse it behind each alternate ID.
  const stream=await capture({
   ...constraints,
   audio:audioId==='test-mic'?{...constraints.audio,deviceId:undefined}:constraints.audio,
   video:videoId==='test-camera'?{...constraints.video,deviceId:undefined}:constraints.video,
  });
  if(constraints.audio){
   const ctx=new Audio();
   await ctx.resume();
   const tone=ctx.createOscillator(),gain=ctx.createGain(),destination=ctx.createMediaStreamDestination();
   let signal=tone;
   if(window.testNoise){
    const buffer=ctx.createBuffer(1,ctx.sampleRate,ctx.sampleRate);
    let seed=1234;
    let rumble=0;
    buffer.getChannelData(0).forEach((_,i,samples)=>{
     seed=(Math.imul(1664525,seed)+1013904223)>>>0;
     const broadband=seed/2147483648-1;
     const rotation=2*Math.PI*60*i/ctx.sampleRate;
     rumble=rumble*0.96+broadband*0.04;
     samples[i]=0.45*Math.sin(rotation)+0.2*Math.sin(2*rotation)+0.35*rumble+0.08*broadband;
    });
    signal=ctx.createBufferSource();
    signal.buffer=buffer;
    signal.loop=true;
   }
   gain.gain.value=window.testNoise?0.015:0.15;
   signal.connect(gain).connect(destination);
   signal.start();
   stream.getAudioTracks().forEach(track=>{track.stop();stream.removeTrack(track)});
   const track=destination.stream.getAudioTracks()[0],stop=track.stop.bind(track);
   track.stop=()=>{if(track.readyState==='ended')return;stop();signal.stop();void ctx.close()};
   stream.addTrack(track);
  }
  window.media.push(stream);
  for(const track of stream.getTracks()){
   window.capturedTracks.push(track);
   window.deviceForTrack.set(track,track.kind==='audio'?audioId:videoId);
  }
  return stream;
 };
 const setSink=HTMLMediaElement.prototype.setSinkId;
 const sinkId=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'sinkId');
 const sinkForElement=new WeakMap();
 HTMLMediaElement.prototype.setSinkId=async function(id){
  if(setSink)await setSink.call(this,id==='test-speaker'?'':id);
  sinkForElement.set(this,id);
 };
 Object.defineProperty(HTMLMediaElement.prototype,'sinkId',{
  configurable:true,
  get(){return sinkForElement.get(this)??sinkId?.get.call(this)??''},
 });
}
async function connect(url,attachFixtures=true){const ws=new WebSocket(url);sockets.push(ws);await new Promise(r=>ws.addEventListener('open',r,{once:true}));let id=0;const pending=new Map();ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(pending.has(m.id)){const [resolve,reject]=pending.get(m.id);pending.delete(m.id);m.error?reject(m.error):resolve(m.result)}});const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,[resolve,reject]);ws.send(JSON.stringify({id:n,method,params}))});const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value};const wait=async expression=>{for(let i=0;i<160;i++){if(await ev(expression))return;await new Promise(r=>setTimeout(r,100))}throw new Error('Timeout '+expression+' '+await ev('document.body.innerText'))};if(attachFixtures){await send('Page.enable');await send('Page.addScriptToEvaluateOnNewDocument',{source:`(${installDeviceFixtures.toString()})(${JSON.stringify(relayIce)})`})}return {send,ev,wait};}
try{
 let pages;for(let i=0;i<80;i++){try{pages=await(await fetch('http://127.0.0.1:9334/json')).json();break}catch{await new Promise(r=>setTimeout(r,100))}}
 const a=await connect(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
 await a.send('Emulation.setDeviceMetricsOverride',{width:1920,height:1028,deviceScaleFactor:1,mobile:false});
 await a.send('Page.navigate',{url:'http://127.0.0.1:4193/#login'});await a.wait("!!document.querySelector('#email')");
 await a.ev('localStorage.clear()');
 await a.ev("fetch('/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'me'})}).then(r=>r.json())");
 const text=readFileSync(process.env.MINES_DATA_DIR+'/FIRST-USER.txt','utf8');const email=text.match(/Email: (.+)/)[1].trim(),password=text.match(/Password: (.+)/)[1].trim();
 await a.ev(`document.querySelector('#email').value=${JSON.stringify(email)};document.querySelector('#password').value=${JSON.stringify(password)};document.querySelector('form').requestSubmit()`);await a.wait("!!document.querySelector('.profile-name strong')");
 const shot=async(name)=>{await a.ev('document.fonts.ready');const result=await a.send('Page.captureScreenshot',{format:'png'});writeFileSync('voice-qa/'+name+'.png',Buffer.from(result.data,'base64'))};
 const pointerClick=async(expression,tab=a)=>{
  const {x,y}=await tab.ev(`(()=>{const el=${expression};el.scrollIntoView({block:'nearest'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await tab.send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});
  await tab.send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});
 };
 const chooseDevice=async(key,label)=>{
  const trigger=`document.querySelector('#voice-${key}')`;
  await a.wait(`${trigger}&&! ${trigger}.disabled`);
  await pointerClick(trigger);
  const option=`[...document.querySelectorAll('[role=option]')].find(el=>el.textContent===${JSON.stringify(label)})`;
  await a.wait(`!!${option}`);
  await pointerClick(option);
 };
 const openVoiceSettings=()=>a.ev("document.querySelector('[title=\"Настройки голоса и видео\"]').click()");
 const closeSettings=()=>a.ev("document.querySelector('[title=\"Закрыть настройки\"]').click()");
 await shot('chat');
 const selectRoom=`[...document.querySelectorAll('.channel')].find(e=>e.textContent.includes('Команда 1')).click()`;
 await a.ev("document.querySelector('.server-rail button[title=LordDevil]').click()");
 await a.ev(selectRoom);await a.wait("!!document.querySelector('.voice-stage')");await shot('room-empty');
 const micButton='document.querySelector(\'.profile button[aria-label="Микрофон"]\')';
 const headphonesButton='document.querySelector(\'.profile button[aria-label="Наушники"]\')';
 const setFooter=async(button,pressed)=>{
  await a.ev(`${button}?.click()`);
  await a.wait(`${button}?.getAttribute('aria-pressed')==='${pressed}'`);
 };
 await setFooter(micButton,true);
 await pointerClick("document.querySelector('.voice-controls button')");await a.wait("!!document.querySelector('.voice-hangup')");
 await a.wait("document.querySelectorAll('.voice-channel-participant').length===1");
 assert.equal(await a.ev("document.querySelectorAll('.voice-channel-participant [role=meter]').length"),1,'Participant must have a microphone level meter');
 assert.equal(await a.ev("capturedTracks[0].enabled"),false);
 const browser=await connect((await(await fetch('http://127.0.0.1:9334/json/version')).json()).webSocketDebuggerUrl,false);
 const {browserContextId}=await browser.send('Target.createBrowserContext');
 const {targetId}=await browser.send('Target.createTarget',{url:'about:blank',browserContextId});
 pages=await(await fetch('http://127.0.0.1:9334/json')).json();const b=await connect(pages.find(p=>p.id===targetId).webSocketDebuggerUrl);
 await b.send('Page.navigate',{url:'http://127.0.0.1:4193/#login'});await b.wait("!!document.querySelector('#email')");
 const apiResponse=(tab,body)=>tab.ev(`fetch('/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify(body)})}).then(r=>r.json())`);
 const request=async(tab,body)=>{
  const reply=await apiResponse(tab,body);
  assert.ok(!reply.error,reply.error);
  return reply.data;
 };
 const participantEmail='voice-participant@example.com';
 await request(b,{op:'register',name:'Voice Participant',email:participantEmail,password:'voice-participant-qa-password'});
 const group=(await request(a,{op:'state'})).groups.find(group=>group.name==='LordDevil');
 await request(a,{op:'invite_group_member',group:group.id,email:participantEmail});
 const statusRoom=group.channels.find(channel=>channel.kind==='voice'&&channel.name.includes('Команда 2')).id;
 const legacyPeer={room:statusRoom,client:crypto.randomUUID()};
 const observer={room:statusRoom,client:crypto.randomUUID()};
 const checkPresence=(peers,muted,deaf)=>{
  const peer=peers.find(peer=>peer.client===legacyPeer.client);
  assert.deepEqual(peer&&{muted:peer.muted,deaf:peer.deaf},{muted,deaf});
  assert.equal(Object.hasOwn(peer,'session'),false);
 };
 await request(a,{op:'voice_join',...legacyPeer});
 checkPresence((await request(b,{op:'voice_join',...observer})).peers,false,false);
 await request(a,{op:'voice_poll',...legacyPeer,muted:true,deaf:true});
 assert.ok((await apiResponse(b,{op:'voice_poll',...legacyPeer,muted:false,deaf:false})).error);
 await request(a,{op:'voice_poll',...legacyPeer});
 checkPresence((await request(b,{op:'voice_poll',...observer})).peers,true,true);
 await request(a,{op:'voice_leave',...legacyPeer});
 await request(b,{op:'voice_leave',...observer});
 assert.deepEqual(await a.ev('voiceCues'),[]);
 await b.send('Page.reload');await b.wait("!!document.querySelector('.server-rail button[title=LordDevil]')");await b.ev("document.querySelector('.server-rail button[title=LordDevil]').click()");await b.ev(selectRoom);await b.wait("!!document.querySelector('.voice-controls button')");await pointerClick("document.querySelector('.voice-controls button')",b);
 await a.wait("window.pcs.some(p=>p.connectionState==='connected')");await b.wait("window.pcs.some(p=>p.connectionState==='connected')");
 await a.wait("voiceCues.some(({cue})=>cue==='peer-joined')");
 assert.deepEqual(await b.ev('voiceCues'),[]);
 const remoteStatus=(label)=>`!!document.querySelector('.voice-channel-participant[title="HollyWood"] [aria-label="${label}"]')`;
 const micOff=remoteStatus('Микрофон выключен'),headphonesOff=remoteStatus('Звук выключен');
 await b.wait(micOff);
 assert.equal(await b.ev(headphonesOff),false);
 await setFooter(micButton,false);
 await b.wait(`!${micOff}`);
 await a.wait("document.querySelector('.voice-stage').innerText.includes('На связи')");
 const playbackReady="(()=>{const el=document.querySelector('.voice-playback audio');return !!el&&!el.paused&&!el.muted&&el.volume>0&&el.readyState>=2&&el.currentTime>0&&el.srcObject.getVideoTracks().length===0})()";
 await a.wait(playbackReady);
 await b.wait(playbackReady);
 console.log('PASS: both audio players are playing with both cameras off.');
 const bUser=(await request(b,{op:'me'})).user;
 await request(a,{op:'create_dialog',name:'Проверка звонка',members:[bUser.id]});
 await a.ev("window.callAudio=document.querySelector('.voice-playback audio'); window.audioClock=callAudio.currentTime; document.querySelector('.server-rail [title=\"Личные сообщения\"]').click(); void 0");
 await a.wait("!!document.querySelector('.dialog-row')");
 await pointerClick("document.querySelector('.dialog-row')");
 await a.ev("window.failNextVoicePoll=true");
 await a.wait("window.failNextVoicePoll===false && !document.querySelector('.voice-stage') && !!document.querySelector('.voice-status') && callAudio===document.querySelector('.voice-playback audio') && !callAudio.paused && callAudio.currentTime>audioClock+1.5");
 await a.ev("document.querySelector('.server-rail button[title=LordDevil]').click()");
 await a.ev(selectRoom);
 await a.wait("!!document.querySelector('.voice-hangup') && callAudio===document.querySelector('.voice-playback audio')");
 console.log('PASS: audio keeps playing in a direct conversation during a group call.');
 await a.ev("document.querySelector('[title=\"Включить камеру\"]').click()");await a.wait("!!document.querySelector('[title=\"Выключить камеру\"]')");
 console.log("Transceivers A",await a.ev("window.pcs.map(p=>p.getTransceivers().map(t=>({mid:t.mid,d:t.direction,c:t.currentDirection,s:t.sender.track?.kind,r:t.receiver.track.kind})))"));console.log("Transceivers B",await b.ev("window.pcs.map(p=>p.getTransceivers().map(t=>({mid:t.mid,d:t.direction,c:t.currentDirection,s:t.sender.track?.kind,r:t.receiver.track.kind})))")); await b.wait("window.pcs.some(p=>p.getReceivers().some(r=>r.track.kind==='video'&&!r.track.muted))");
 await a.wait("window.pcs.some(p=>p.getTransceivers().filter(t=>t.currentDirection===\u0027sendrecv\u0027).length===2)"); await b.wait("window.pcs.some(p=>p.getTransceivers().filter(t=>t.currentDirection===\u0027sendrecv\u0027).length===2)"); const stats=await b.ev("Promise.all(window.pcs.map(async pc=>[...await pc.getStats()].filter(([k,v])=>v.type==='inbound-rtp').map(([k,v])=>({kind:v.kind,bytes:v.bytesReceived}))))");assert.ok(stats.flat().some(s=>s.kind==='audio'&&s.bytes>0));console.log('Connected peers and receiving RTP',JSON.stringify(stats));
 await a.wait("document.querySelectorAll('.voice-channel-participant').length===2");
 console.log('Meter diagnostics',await a.ev("({meters:[...document.querySelectorAll('[role=meter]')].map(m=>m.outerHTML),contexts:window.contexts.map(c=>c.state),tracks:window.pcs.map(p=>p.getReceivers().map(r=>({kind:r.track.kind,muted:r.track.muted,state:r.track.readyState})))})"));
 await a.wait("[...document.querySelectorAll('.voice-channel-participant [role=meter]')].length===2 && [...document.querySelectorAll('.voice-channel-participant [role=meter]')].every(m=>Number(m.getAttribute('aria-valuenow'))>0)");
 await b.wait("[...document.querySelectorAll('.voice-channel-participant [role=meter]')].length===2 && [...document.querySelectorAll('.voice-channel-participant [role=meter]')].every(m=>Number(m.getAttribute('aria-valuenow'))>0)");
 await a.wait(playbackReady);
 await b.wait(playbackReady);
 if(relayIce){
  const candidateType=`(async()=>{const stats=await window.pcs[0].getStats();const transport=[...stats.values()].find(report=>report.selectedCandidatePairId);const pair=stats.get(transport.selectedCandidatePairId);return stats.get(pair.localCandidateId).candidateType;})()`;
  assert.equal(await a.ev(candidateType),'relay');
  assert.equal(await b.ev(candidateType),'relay');
  console.log('PASS: both clients received audio over TURN and saw both microphone meters move.');
 }
 await shot('room-connected');
 await setFooter(micButton,true);
 assert.equal(await a.ev("window.media[0].getAudioTracks()[0].enabled"),false);
 await b.wait(micOff);
 await a.wait("document.querySelector('[role=meter]').getAttribute('aria-valuenow')==='0'");
 await b.wait("[...document.querySelectorAll('[role=meter]')].at(-1).getAttribute('aria-valuenow')==='0'");
 await shot('room-mic-muted');
 await a.ev("window.beforeSwitch=window.pcs.find(p=>p.connectionState==='connected'); window.senderFor=kind=>beforeSwitch.getTransceivers().find(t=>t.receiver.track.kind===kind).sender; window.oldMic=senderFor('audio').track; window.oldCamera=senderFor('video').track; window.playback=document.querySelector('.voice-playback audio'); void 0");
 await openVoiceSettings();
 await a.wait("!!document.querySelector('#voice-echo')");
 await a.ev("document.querySelector('#voice-echo').click()");
 await a.wait("oldMic.readyState==='ended' && beforeSwitch.connectionState==='connected' && beforeSwitch.getSenders().some(s=>s.track?.kind==='audio'&&!s.track.enabled)");
 await a.ev("window.oldMic=senderFor('audio').track; void 0");
 await chooseDevice('mic','Запасной микрофон');
 await a.wait("oldMic.readyState==='ended' && deviceForTrack.get(senderFor('audio').track)==='test-mic' && !senderFor('audio').track.enabled");
 await chooseDevice('mic','Недоступный микрофон');
 await a.wait("document.querySelector('.voice-settings [role=alert]')?.textContent.includes('Устройство не найдено')");
 assert.equal(await a.ev("deviceForTrack.get(senderFor('audio').track)"),'test-mic');
 assert.equal(await a.ev("document.querySelector('#voice-mic').textContent"),'Запасной микрофон');
 await chooseDevice('camera','Запасная камера');
 await a.wait("oldCamera.readyState==='ended' && deviceForTrack.get(senderFor('video').track)==='test-camera'");
 await chooseDevice('speaker','Запасные динамики');
 await a.wait("playback===document.querySelector('.voice-playback audio') && playback.sinkId==='test-speaker'");
 await closeSettings();
 await a.ev(`window.originalPlaybackAudio=playback.srcObject.getAudioTracks()[0]; document.querySelector('.voice-channel-participant[title="Voice Participant"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,clientX:140,clientY:440})); void 0`);
 const volumeThumb='document.querySelector(\'[role=slider][aria-label="Громкость пользователя"]\')';
 await a.wait(`!!${volumeThumb}`);
 await a.ev(`${volumeThumb}.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'End'}))`);
 await a.wait(`${volumeThumb}?.getAttribute('aria-valuenow')==='200'`);
 await a.wait(`playbackGains.some(node=>node.gain.value===2 && node.context.state==='running') && playback.srcObject.getAudioTracks()[0]!==originalPlaybackAudio && playback.sinkId==='test-speaker'`);
 const measureGain=(inputTrack,outputTrack,settle=350,observations=1)=>a.ev(`(async()=>{
  const context=new AudioContext();
  try{
   const measure=track=>{
    const analyser=context.createAnalyser();
    context.createMediaStreamSource(new MediaStream([track])).connect(analyser);
    const samples=new Float32Array(analyser.fftSize);
    return ()=>{analyser.getFloatTimeDomainData(samples);return Math.sqrt(samples.reduce((sum,value)=>sum+value*value,0)/samples.length)};
   };
   const input=measure(${inputTrack});
   const output=measure(${outputTrack});
   await context.resume();
   await new Promise(resolve=>setTimeout(resolve,${settle}));
   let before=0,after=0;
   for(let i=0;i<${observations};i++){
    before+=input()**2;
    after+=output()**2;
    if(i+1<${observations})await new Promise(resolve=>setTimeout(resolve,53));
   }
   return Math.sqrt(after/before);
  }finally{await context.close()}
 })()`);
 const gainRatio=await measureGain('originalPlaybackAudio','playback.srcObject.getAudioTracks()[0]');
 assert.ok(gainRatio>1.8&&gainRatio<2.2,`200% should double the audio signal. Observed ratio: ${gainRatio}`);
 await a.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
 await setFooter(headphonesButton,true);
 await a.wait("playback.muted && !senderFor('audio').track.enabled");
 await b.wait(`${micOff} && ${headphonesOff}`);
 await openVoiceSettings();
 await chooseDevice('speaker','По умолчанию');
 await a.wait("playback.muted && playback.sinkId===''");
 await closeSettings();
 await setFooter(headphonesButton,false);
 await a.wait("!playback.muted && !senderFor('audio').track.enabled");
 await b.wait(`${micOff} && !${headphonesOff}`);
 await a.ev("document.querySelector('[title=\"Выключить камеру\"]').click()");
 await a.wait("!!document.querySelector('[title=\"Включить камеру\"]') && !senderFor('video').track");
 await a.ev("window.capturesWhileCameraOff=capturedTracks.length");
 await openVoiceSettings();
 await chooseDevice('camera','По умолчанию');
 await a.wait("document.querySelector('#voice-camera').textContent==='По умолчанию'");
 assert.equal(await a.ev("capturedTracks.length"),await a.ev("capturesWhileCameraOff"));
 assert.equal(await a.ev("senderFor('video').track"),null);
 await closeSettings();
 await a.ev("document.querySelector('[title=\"Включить камеру\"]').click()");
 await a.wait("senderFor('video').track?.readyState==='live' && !deviceForTrack.get(senderFor('video').track)");
 assert.equal(await a.ev("window.pcs.length===1 && beforeSwitch.connectionState==='connected'"),true);
 assert.equal(await b.ev("window.pcs.length===1 && window.pcs[0].connectionState==='connected'"),true);
 const openOwnMenu=()=>a.ev(`document.querySelector('.voice-channel-participant:has(small)').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,clientX:140,clientY:410}))`);
 const micThumb='document.querySelector(\'[role=slider][aria-label="Громкость микрофона"]\')';
 const setMicVolume=async(key,expected)=>{
  await openOwnMenu();
  await a.wait(`!!${micThumb}`);
  await a.ev(`${micThumb}.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:${JSON.stringify(key)}}))`);
  await a.wait(`${micThumb}?.getAttribute('aria-valuenow')==='${expected}'`);
  await a.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
 };
 await a.ev("window.rawMic=senderFor('audio').track; void 0");
 await setMicVolume('End',200);
 await a.wait("senderFor('audio').track!==rawMic && !senderFor('audio').track.enabled && rawMic.readyState==='live'");
 await a.ev("document.querySelector('.voice-controls [title=\"Включить микрофон\"]').click()");
 await a.wait("Number(document.querySelector('[role=meter]').getAttribute('aria-valuenow'))>0");
 await b.wait("Number([...document.querySelectorAll('[role=meter]')].at(-1).getAttribute('aria-valuenow'))>0");
 const micRatio=await measureGain('rawMic',"senderFor('audio').track");
 assert.ok(micRatio>1.8&&micRatio<2.2,`200% should double the microphone signal. Observed ratio: ${micRatio}`);
 await a.ev("window.processedMic=senderFor('audio').track; void 0");
 await openVoiceSettings();
 await chooseDevice('mic','По умолчанию');
 await a.wait("rawMic.readyState==='ended' && senderFor('audio').track===processedMic && document.querySelector('#voice-mic').textContent==='По умолчанию'");
 await closeSettings();
 await setMicVolume('Home',0);
 await b.wait("[...document.querySelectorAll('[role=meter]')].at(-1).getAttribute('aria-valuenow')==='0'");
 await openVoiceSettings();
 await chooseDevice('speaker','Запасные динамики');
 await a.wait("playback.sinkId==='test-speaker'");
 await closeSettings();
 await setFooter(headphonesButton,true);
 await b.wait(`${micOff} && ${headphonesOff}`);
 await openOwnMenu();
 await a.wait("[...document.querySelectorAll('[role=menuitem]')].some(el=>el.textContent==='Выйти из голосовой комнаты')");
 await pointerClick("[...document.querySelectorAll('[role=menuitem]')].find(el=>el.textContent==='Выйти из голосовой комнаты')");
 await a.wait("capturedTracks.every(t=>t.readyState==='ended') && playbackGains.every(node=>node.context.state==='closed')");await b.wait("document.querySelector('.voice-stage').innerText.includes('Пригласите друзей')");
 await a.wait("voiceCues.some(({cue})=>cue==='left')");
 assert.deepEqual(await a.ev('voiceCues.map(({cue})=>cue)'),['peer-joined','left']);
 assert.equal(await a.ev('voiceCues.at(-1).sink'),'test-speaker');
 await b.wait("voiceCues.filter(({cue})=>cue==='left').length===1");
 assert.deepEqual(await b.ev('voiceCues.map(({cue})=>cue)'),['left'],'Remaining participant hears the other person leave');
 assert.equal(await a.ev(`${headphonesButton}.getAttribute('aria-pressed')`),'true');
 assert.equal(await a.ev(`${micButton}.getAttribute('aria-pressed')`),'true');
 await setFooter(micButton,false);
 assert.equal(await a.ev(`${headphonesButton}.getAttribute('aria-pressed')`),'false');
 await a.wait("document.querySelectorAll('.voice-channel-participant').length===1 && !!document.querySelector('.voice-channel-participant[title=\"Voice Participant\"]') && !document.querySelector('.voice-channel-participant [role=meter]')");
 await b.wait("document.querySelectorAll('.voice-channel-participant').length===1");
 await a.ev("document.querySelector('[title=\"Настройки пользователя\"]').click()");await a.wait("!!document.querySelector('.account-modal')");await a.ev("[...document.querySelectorAll('.settings-sidebar button')].find(b=>b.textContent.includes('Голос и видео')).click()");await a.wait("!!document.querySelector('.voice-settings')");await shot('settings');
 await a.ev("[...document.querySelectorAll('.voice-test-actions button')].find(b=>b.textContent.includes('Проверить камеру')).click()");await a.wait("!!document.querySelector('.voice-settings video')");await shot('settings-preview');await closeSettings();await a.wait("capturedTracks.every(t=>t.readyState==='ended')");
 await a.ev("window.testNoise=true");
 await pointerClick("document.querySelector('.voice-controls button')");
 await a.wait("!!document.querySelector('.voice-hangup')");
 assert.equal(await a.ev("audioConstraints.at(-1).autoGainControl"),false,'Standard noise suppression must disable automatic microphone gain');
 await a.wait("pcs.some(pc=>pc.connectionState==='connected')");
 await b.wait("pcs.some(pc=>pc.connectionState==='connected')");
 const receivedNoiseRms=()=>b.ev(`(async()=>{
  const receiver=pcs.find(pc=>pc.connectionState==='connected').getReceivers().find(r=>r.track.kind==='audio');
  const stats=async()=>[...(await receiver.getStats()).values()].find(report=>report.type==='inbound-rtp');
  const before=await stats();
  await new Promise(resolve=>setTimeout(resolve,1200));
  const after=await stats();
  return Math.sqrt((after.totalAudioEnergy-before.totalAudioEnergy)/(after.totalSamplesDuration-before.totalSamplesDuration));
 })()`);
 await b.wait(playbackReady);
 const receivedBaseline=await receivedNoiseRms();
 await a.ev("window.noiseCall=pcs.find(pc=>pc.connectionState==='connected'); window.noiseSender=noiseCall.getSenders().find(s=>s.track.kind==='audio'); void 0");
 await pointerClick("document.querySelector('.voice-controls [title=\"Настройки голоса и видео\"]')");
 assert.equal(await a.ev("document.querySelector('#voice-noise')?.textContent"),'Стандартное');
 await a.ev("document.querySelector('#voice-echo').click()");
 await a.wait("audioConstraints.at(-1).echoCancellation===true && audioConstraints.at(-1).advanced?.some(rule=>rule.echoCancellation==='all') && !document.querySelector('#voice-noise').disabled");
 await chooseDevice('noise','Усиленное (RNNoise)');
 await a.wait("document.querySelector('#voice-noise')?.textContent==='Усиленное (RNNoise)' && audioConstraints.at(-1).noiseSuppression===false");
 assert.equal(await a.ev("audioConstraints.at(-1).autoGainControl"),false,'Automatic microphone gain must also be disabled before RNNoise');
 assert.equal(await a.ev("noiseSender.track!==capturedTracks.at(-1)"),true);
 const noiseRatio=await measureGain('capturedTracks.at(-1)','noiseSender.track',1500,20);
 assert.equal(await a.ev("noiseWorklets.length===1 && !noiseWorkletFailed"),true);
 assert.ok(noiseRatio>0.0001&&noiseRatio<0.98,`RNNoise should attenuate noise without silencing the output. Observed ratio: ${noiseRatio}`);
 const receivedRatio=(await receivedNoiseRms())/receivedBaseline;
 assert.ok(receivedRatio>0.0001&&receivedRatio<0.9,`RNNoise should reduce the noise heard by the other participant without silencing the track. Observed ratio: ${receivedRatio}`);
 assert.equal(await a.ev("noiseCall.connectionState"),'connected');
 await chooseDevice('noise','Выключено');
 await a.wait("document.querySelector('#voice-noise')?.textContent==='Выключено' && noiseSender.track===capturedTracks.at(-1)");
 assert.equal(await a.ev("capturedTracks.at(-2).readyState"),'ended');
 assert.equal(await a.ev("audioConstraints.at(-1).noiseSuppression"),false);
 assert.equal(await a.ev("audioConstraints.at(-1).autoGainControl"),true,'Turning suppression off restores automatic microphone gain');
 await closeSettings();
 await pointerClick("document.querySelector('.voice-hangup')");
 await a.wait("capturedTracks.every(track=>track.readyState==='ended')");
 await b.ev("window.failVoicePoll=true");
 await b.wait("!document.querySelector('.voice-hangup') && voiceCues.filter(({cue})=>cue==='left').length>=2");
 await a.wait("document.querySelectorAll('.voice-channel-participant').length===0");
 console.log('PASS: voice playback, live devices, gain, mute, camera, presence, cues and live noise modes. RNNoise noise RMS ratios:',{sender:noiseRatio,receiver:receivedRatio});
}finally{sockets.forEach(s=>s.close());chrome.kill();await new Promise(r=>server.httpServer.close(r))}

