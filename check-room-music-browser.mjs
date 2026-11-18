import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {browser,click,fixtureServer,port,stopProcess,until} from './check-voice-navigation-browser.mjs';

const out=`voice-qa/music-${Date.now()}`, duration=30, rate=8000;
mkdirSync(out,{recursive:true});
// Locally generated piano-like notes; no third-party media or credentials.
const wave=Buffer.alloc(44+duration*rate*2);
wave.write('RIFF');wave.writeUInt32LE(wave.length-8,4);wave.write('WAVEfmt ',8);wave.writeUInt32LE(16,16);wave.writeUInt16LE(1,20);wave.writeUInt16LE(1,22);wave.writeUInt32LE(rate,24);wave.writeUInt32LE(rate*2,28);wave.writeUInt16LE(2,32);wave.writeUInt16LE(16,34);wave.write('data',36);wave.writeUInt32LE(wave.length-44,40);
for(let i=0;i<duration*rate;i++){const t=i/rate, beat=t%0.5,f=[220,261.63,329.63,392][Math.floor(t*2)%4];wave.writeInt16LE(Math.round(3500*Math.sin(2*Math.PI*f*beat)*Math.min(1,beat*100)*Math.exp(-7*beat)),44+i*2)}
writeFileSync(`${out}/test.wav`,wave);
writeFileSync(`${out}/fixture.tsx`,`import React from 'react';import {createRoot} from 'react-dom/client';import {LiveChat} from '/ui/app/live-chat.tsx';import '/ui/app/glass.css';createRoot(document.getElementById('root')).render(<LiveChat/>);`);
writeFileSync(`${out}/index.html`,'<!doctype html><meta charset="utf-8"><div id="root"></div><script type="module" src="./fixture.tsx"></script>');
writeFileSync(`${out}/blank.html`,'<!doctype html><meta charset="utf-8"><p>Music QA</p>');
const sockets=[],chromes=[];let backend,server;
const q=s=>`document.querySelector(${JSON.stringify(s)})`;
const contains=(s,text)=>`Array.from(document.querySelectorAll(${JSON.stringify(s)})).find(e=>e.textContent.includes(${JSON.stringify(text)}))`;
const input=async(tab,selector,text)=>{await click(tab,q(selector));await tab.send('Input.insertText',{text})};
try{
 const backendPort=await port(), origin=`http://127.0.0.1:${backendPort}`;
 const {server:s,webPort}=await fixtureServer(out,[],{'/api':origin});server=s;
 const web=`http://127.0.0.1:${webPort}`;
 const catalog=process.env.SOMBRA_QA_MUSIC_SOURCE?JSON.parse(process.env.SOMBRA_QA_MUSIC_SOURCE):{url:`${web}/${out}/test.wav`,title:'QA Music',durationMs:duration*1000};
 const url=process.argv.includes('--private')?'https://music.yandex.ru/album/13886032/track/71663565':catalog.inputUrl??catalog.url;
 const privateTest=process.argv.includes('--private');
 const launch=(enabled=false)=>spawn(resolve(process.env.SOMBRA_QA_SERVER_EXE||'target/debug/mines-server.exe'),[],{windowsHide:true,stdio:'inherit',env:{...process.env,MINES_DATA_DIR:resolve(out,'data'),MINES_BIND:`127.0.0.1:${backendPort}`,MINES_MUSIC_TEST_CATALOG:JSON.stringify([catalog]),MINES_MUSIC_PRIVATE_TRACK:enabled?'1':'0'}});
 backend=launch();
 await until(async()=>(await fetch(origin+'/health')).ok,'isolated backend');
 const actors=[];
 const api=async(t,data)=>{const res=await t.ev(`fetch('/api',{method:'POST',headers:{'Content-Type':'application/json'},body:${JSON.stringify(JSON.stringify(data))}}).then(async r=>({status:r.status,...await r.json()}))`);assert(res.status<400,JSON.stringify(res));return res.data};
 for(let i=0;i<2;i++){
  const {chrome,tab}=await browser(`${out}/actor-${i}`,sockets);chromes.push(chrome);actors.push(tab);
  await tab.send('Page.navigate',{url:`${web}/${out}/blank.html`});await tab.wait(`document.body?.textContent.includes('Music QA')`);
  await api(tab,{op:'register',email:`music-${i}@local.test`,password:'Synthetic-Music-123!',name:`QA Music ${i}`});
 }
 const [a,b]=actors,group=await api(a,{op:'create_group',name:'QA Music Group'});
 await api(a,{op:'invite_group_member',group:group.id,email:'music-1@local.test'});
 const g=(await api(a,{op:'state'})).groups.find(x=>x.id===group.id);
 const voice=g.channels.find(x=>x.kind==='voice')??await api(a,{op:'create_channel',group:group.id,name:'QA music room',kind:'voice'});
 if(privateTest){
  const dir=resolve(out,'data','private-music');mkdirSync(dir,{recursive:true,mode:0o700});
  const audio=spawnSync('ffmpeg',['-nostdin','-v','error','-i',resolve(out,'test.wav'),'-f','mp3','pipe:1']);
  assert.equal(audio.status,0,'FFmpeg MP3 fixture');
  writeFileSync(resolve(dir,'track.mp3'),audio.stdout,{mode:0o600});
  writeFileSync(resolve(dir,'track.json'),JSON.stringify({roomId:voice.id,inputUrl:url,title:catalog.title,durationMs:catalog.durationMs}),{mode:0o600});
  await stopProcess(backend);backend=launch(true);
  await until(async()=>(await fetch(origin+'/health')).ok,'private backend');
 }
 for(const t of actors){
  await t.send('Page.navigate',{url:`${web}/${out}/index.html`});
  await click(t,q('.server-rail [title="QA Music Group"]'));
  await click(t,contains('.voice-channel .channel',voice.name));
  await click(t,contains('.voice-controls button','Присоединиться'));
  await t.wait(`!!${q('.room-music-add input')}&&!${q('.room-music-add input')}.disabled`);
 }
 assert(await a.ev(`(()=>{const b=document.querySelector('.room-music-header button'),field=document.querySelector('.room-music-add input');return b.dataset.aui==='button'&&field.dataset.aui==='input'&&getComputedStyle(b).boxShadow==='none'&&getComputedStyle(b).backdropFilter==='none'&&getComputedStyle(b).height==='40px'&&getComputedStyle(field).height==='40px'})()`),'Original controls do not inherit call-button glass');
 const media=privateTest?q('audio[src^="blob:"]'):q(`audio[src="${catalog.url}"]`);
 await input(a,'.room-music-add input',url);await click(a,q('.room-music-add button'));
 for(const t of actors)await t.wait(`!!${media}&&!${media}.paused&&${media}.currentTime>0`);
 const [pa,pb]=await Promise.all(actors.map(t=>t.ev(`${media}.currentTime`)));assert(Math.abs(pa-pb)<2,`${pa} vs ${pb}`);
 if(catalog.inputUrl)for(const t of actors)assert(await t.ev(`${media}.duration>60`),'Expected the decoded Yandex sample to exceed 60 seconds in both clients');
 await input(a,'[data-slot="composer-input"]',`/play ${url}`);
 for(const type of ['keyDown','keyUp'])await a.send('Input.dispatchKeyEvent',{type,key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
 await click(b,q('.room-music-header button'));await b.wait(`!!${contains('.room-music-queue li',catalog.title)}`);
 await click(b,q('.room-music-actions button[aria-label="Пауза"]'));
 for(const t of actors)await t.wait(`!!${q('.room-music-actions button[aria-label="Продолжить"]')}&&${media}.paused`);
 await click(a,q('.room-music-actions button[aria-label="Продолжить"]'));
 await b.wait(`!${media}.paused`);
 await click(a,q('.room-music-actions button[aria-label="Следующий трек"]'));
 await b.wait(`!${q('.room-music-queue li')}&&!!${media}&&!${media}.paused`);
 await input(a,'.room-music-add input','https://music.yandex.ru/track/12345');await click(a,q('.room-music-add button'));
 await a.wait(`!!${contains('.room-music [role="alert"]','Яндекс Музыка пока не подключена')}`);
 await click(b,q('.server-rail [title="Личные сообщения"]'));await b.wait(`!${q('.room-music')}&&!!${media}&&!${media}.paused`);
 await click(a,q('.room-music-actions button[aria-label="Остановить и очистить очередь"]'));
 for(const t of actors)await t.wait(`!${media}`);
 console.log('PASS: two real browser sessions, actual audio, synchronized queue, pause/resume/skip/stop, navigation continuity, Yandex-not-connected state');
}finally{for(const ws of sockets)ws.close();for(const chrome of chromes)await stopProcess(chrome);if(server)await server.close();await stopProcess(backend)}
