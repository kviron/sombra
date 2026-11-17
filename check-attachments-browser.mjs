import {preview} from 'vite';
import {spawn} from 'node:child_process';
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';

// Isolated browser contract test: the real production UI talks to an in-page API fixture.
// No deployed service, account, or retained server data is touched.
const output='attachments-qa';mkdirSync(output,{recursive:true});
const server=await preview({preview:{host:'127.0.0.1',port:4197,strictPort:true}});
const chrome=spawn(process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',[
 '--headless=new','--no-sandbox','--disable-gpu','--no-first-run',
 '--remote-debugging-port=9338','--user-data-dir='+mkdtempSync(join(tmpdir(),'sombra-attachments-')),'about:blank',
],{windowsHide:true,stdio:'ignore'});
let ws;
try{
 let pages;
 for(let n=0;n<100;n++){try{pages=await(await fetch('http://127.0.0.1:9338/json')).json();break}catch{await new Promise(r=>setTimeout(r,100))}}
 assert.ok(pages,'Chrome CDP started');
 ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
 await new Promise(r=>ws.addEventListener('open',r,{once:true}));
 let seq=0;const pending=new Map();
 ws.addEventListener('message',e=>{const v=JSON.parse(e.data);if(pending.has(v.id)){const [resolve,reject]=pending.get(v.id);pending.delete(v.id);v.error?reject(v.error):resolve(v.result)}});
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,[resolve,reject]);ws.send(JSON.stringify({id,method,params}))});
 const evaluate=async expression=>{const v=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(v.exceptionDetails)throw new Error(JSON.stringify(v.exceptionDetails));return v.result.value};
 const wait=async expression=>{for(let n=0;n<150;n++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100))}throw new Error('Timeout: '+expression+'\n'+await evaluate('document.body.innerText'))};
 const shot=async name=>{await evaluate('document.fonts.ready');const v=await send('Page.captureScreenshot',{format:'png'});writeFileSync(`${output}/${name}.png`,Buffer.from(v.data,'base64'))};
 const fixture=()=>{
  const user={id:'owner',name:'Attachment QA',bio:'',created_at:1700000000,online:true};
  const peer={...user,id:'peer',name:'QA Peer'};
  const gif='R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const state={me:user,email:'qa@example.test',users:[user,peer],groups:[{id:'group',name:'Attachment QA',owner:'owner',invite:'invite',members:['owner','peer'],channels:[{id:'text',name:'files',kind:'text'},{id:'other',name:'other',kind:'text'},{id:'voice',name:'voice',kind:'voice'}]}],dialogs:[{id:'dm',name:'DM',members:['owner','peer']}],stickers:[],friends:[],bots:[],voicePresence:{},messages:[]};
  const files={};
  for(const [id,name,mime,data,expired] of [['gif','loop.gif','image/gif',gif,false],['png','pixel.png','image/png',png,false],['binary','report.html','application/octet-stream',btoa('<html>safe download only</html>'),false],['expired','old-file.zip','application/octet-stream','',true]]){
   files[id]={name,mime,data};state.messages.push({id,channel:'text',user:'owner',text:'',time:1700000000,attachment:{id:'asset-'+id,name,mime,size:atob(data).length,expired}});
  }
  window.__qa={state,files,calls:[],downloads:[],errors:[]};
  window.addEventListener('error',e=>window.__qa.errors.push(e.message));
  window.addEventListener('unhandledrejection',e=>window.__qa.errors.push(String(e.reason)));
  const original=window.fetch.bind(window);
  window.fetch=async(input,init)=>{
   if(!String(input).endsWith('/api'))return original(input,init);
   const req=JSON.parse(init.body);window.__qa.calls.push(req);
   let data={};
   if(req.op==='me')data={user,email:state.email};
   else if(req.op==='state')data=state;
   else if(req.op==='attachment_file')data=files[req.message];
   else if(req.op==='message'){
    const id='sent-'+window.__qa.calls.length;
    const message={id,channel:req.channel,user:'owner',text:req.text||'',time:Math.floor(Date.now()/1000)};
    if(req.attachment){files[id]={...req.attachment,mime:req.attachment.mime||'application/octet-stream'};message.attachment={id:'asset-'+id,name:req.attachment.name,size:atob(req.attachment.data).length,mime:files[id].mime,expired:false}}
    state.messages.push(message);data={ok:true};
   }
   return new Response(JSON.stringify({data}),{status:200,headers:{'content-type':'application/json'}});
  };
  HTMLAnchorElement.prototype.click=function(){window.__qa.downloads.push({name:this.download,href:this.href})};
 };
 await send('Page.enable');
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`(${fixture.toString()})()`});
 await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:'http://127.0.0.1:4197/#chat'});
 await wait("!!document.querySelector('.server-rail button[title=\"Attachment QA\"]')");
 await evaluate("document.querySelector('.server-rail button[title=\"Attachment QA\"]').click()");
 await wait("!!document.querySelector('.composer textarea')");
 await wait("document.querySelectorAll('.attachment-preview img').length===2 && [...document.querySelectorAll('.attachment-preview img')].every(i=>i.complete&&i.naturalWidth>0)");
 assert.equal(await evaluate("document.querySelectorAll('.message-attachment').length"),4);
 assert.equal(await evaluate("[...document.querySelectorAll('.message-attachment')].find(x=>x.textContent.includes('old-file.zip')).querySelector('button')===null"),true);
 assert.equal(await evaluate("[...document.querySelectorAll('.message-attachment')].find(x=>x.textContent.includes('report.html')).querySelector('img')===null"),true);
 await shot('history-images-download-expired');
 await evaluate("document.querySelector('button[aria-label=\"Скачать report.html\"]').click()");
 await wait('window.__qa.downloads.length===1');
 assert.equal(await evaluate('window.__qa.downloads[0].name'),'report.html');
 assert.equal(await evaluate("window.__qa.downloads[0].href.startsWith('blob:')"),true);
 const pick=async(name,content='selected bytes',size)=>{
  await evaluate(`(()=>{const file=new File([${size?`new Uint8Array(${size})`:JSON.stringify(content)}],${JSON.stringify(name)},{type:'application/octet-stream'});const dt=new DataTransfer();dt.items.add(file);const input=document.querySelector('.attachment-composer input[type=file]');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 };
 const choose=async name=>{await evaluate(`[...document.querySelectorAll('.channel')].find(x=>x.textContent.trim()===${JSON.stringify(name)}).click()`);await wait(`document.querySelector('.chat-header strong').textContent.trim()===${JSON.stringify(name)}`)};
 await pick('selected.bin');
 await wait("document.querySelector('.attachment-draft')?.textContent.includes('selected.bin')");
 assert.equal(await evaluate("document.querySelector('.composer button[type=submit]').disabled"),false,'attachment-only send enabled');
 await choose('other');
 assert.equal(await evaluate("!!document.querySelector('.attachment-draft')"),false,'draft not leaked into another channel');
 await pick('other.bin');await wait("document.querySelector('.attachment-draft')?.textContent.includes('other.bin')");
 await choose('files');await wait("document.querySelector('.attachment-draft')?.textContent.includes('selected.bin')");
 await shot('attachment-only-draft');
 await evaluate("document.querySelector('.composer').requestSubmit()");
 await wait("window.__qa.calls.some(x=>x.op==='message'&&x.attachment?.name==='selected.bin')");
 const selected=await evaluate("window.__qa.calls.find(x=>x.op==='message'&&x.attachment?.name==='selected.bin')");
 assert.equal(selected.attachment.data,Buffer.from('selected bytes').toString('base64'));
 assert.equal(selected.channel,'text');assert.equal(selected.text,'');
 await wait("!document.querySelector('.attachment-draft')");
 const count=await evaluate("window.__qa.calls.filter(x=>x.op==='message').length");
 await pick('too-large.bin','',10*1024*1024+1);
 await wait("document.body.innerText.includes('Размер файла не должен превышать 10 МиБ.')");
 assert.equal(await evaluate("!!document.querySelector('.attachment-draft')"),false);
 assert.equal(await evaluate("window.__qa.calls.filter(x=>x.op==='message').length"),count,'oversize sends no request');
 await evaluate("(()=>{const t=document.querySelector('.composer textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,'Keep this text');t.dispatchEvent(new Event('input',{bubbles:true}));})()");
 const textNotCancelled=await evaluate("(()=>{const dt=new DataTransfer();dt.setData('text/plain','normal paste');const event=new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:dt});return document.querySelector('.composer textarea').dispatchEvent(event)})()");
 assert.equal(textNotCancelled,true,'plain text paste stays native');
 await evaluate("(()=>{const dt=new DataTransfer();dt.items.add(new File(['paste bytes'],'pasted.txt',{type:'text/plain'}));document.querySelector('.composer textarea').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:dt}))})()");
 await wait("document.querySelector('.attachment-draft')?.textContent.includes('pasted.txt')");
 assert.equal(await evaluate("document.querySelector('.composer textarea').value"),'Keep this text','file paste preserves draft text');
 await shot('paste-keeps-text');
 await evaluate("document.querySelector('.composer').requestSubmit()");
 await wait("window.__qa.calls.some(x=>x.op==='message'&&x.attachment?.name==='pasted.txt')");
 const pasted=await evaluate("window.__qa.calls.find(x=>x.op==='message'&&x.attachment?.name==='pasted.txt')");
 assert.equal(pasted.text,'Keep this text');assert.equal(pasted.attachment.data,Buffer.from('paste bytes').toString('base64'));
 await choose('voice');await pick('voice.bin');await wait("document.querySelector('.attachment-draft')?.textContent.includes('voice.bin')");
 await evaluate("document.querySelector('.composer').requestSubmit()");
 await wait("window.__qa.calls.some(x=>x.op==='message'&&x.channel==='voice'&&x.attachment?.name==='voice.bin')");
 await shot('voice-attachment');
 await evaluate("document.querySelector('.server-rail button').click()");
 await wait("!!document.querySelector('.dialog-row')");await evaluate("document.querySelector('.dialog-row').click()");
 await wait("document.querySelector('.chat-header strong').textContent.trim()==='QA Peer'");
 await pick('dm.bin');await wait("document.querySelector('.attachment-draft')?.textContent.includes('dm.bin')");
 await evaluate("document.querySelector('.composer').requestSubmit()");
 await wait("window.__qa.calls.some(x=>x.op==='message'&&x.channel==='dm'&&x.attachment?.name==='dm.bin')");
 await shot('direct-message-attachment');
 assert.deepEqual(await evaluate('window.__qa.errors'),[],'no browser runtime errors');
 const evidence={passed:true,checks:['PNG/GIF rendered','generic HTML download only','expired metadata UI','file input raw base64','attachment-only enabled','per-channel draft isolation','oversize rejected without send','native text paste not cancelled','file paste preserves text','voice composer','DM composer'],requests:await evaluate("window.__qa.calls.filter(x=>x.op==='message').map(({channel,text,attachment})=>({channel,text,name:attachment?.name,encoded:attachment?.data.length}))")};
 writeFileSync(`${output}/result.json`,JSON.stringify(evidence,null,2));console.log('PASS',JSON.stringify(evidence));
}finally{
 ws?.close();chrome.kill();await new Promise(resolve=>server.httpServer.close(resolve));
}
