import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=(await readFile(new URL('./ui/app/message-read-state.ts',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'');
const {observeMessageReads,sufficientlyVisible}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText).toString('base64'));
test('visibility includes long messages but excludes tiny portions',()=>{assert.equal(sufficientlyVisible(2000,400,600),true);assert.equal(sufficientlyVisible(2000,50,600),false);assert.equal(sufficientlyVisible(20,20,600),true)});
test('dwell, focus, retry, batches and account cancellation',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const doc=new EventTarget(),win=new EventTarget();let focused=true,modal=false,callback;
 Object.assign(doc,{visibilityState:'visible',hasFocus:()=>focused,querySelector:()=>modal?{}:null,body:{}});Object.assign(win,{innerHeight:600});
 const old={document:globalThis.document,window:globalThis.window,IntersectionObserver:globalThis.IntersectionObserver,MutationObserver:globalThis.MutationObserver};
 Object.assign(globalThis,{document:doc,window:win,IntersectionObserver:class{constructor(cb){callback=cb}observe(){}disconnect(){}},MutationObserver:class{observe(){}disconnect(){}}});
 const elements=Array.from({length:205},(_,i)=>({dataset:{readMessageId:String(i)}}));const calls=[];let fail=true;
 const cleanup=observeMessageReads({root:{querySelectorAll:()=>elements},actor:'a',channel:'c',eligible:new Set(elements.map(e=>e.dataset.readMessageId)),send:async ids=>{calls.push(ids);if(fail){fail=false;throw Error('offline')}}});
 const emit=()=>callback(elements.map(target=>({target,isIntersecting:true,boundingClientRect:{height:100},intersectionRect:{height:100},rootBounds:{height:600}})));
 try{emit();t.mock.timers.tick(499);assert.equal(calls.length,0);focused=false;win.dispatchEvent(new Event('blur'));t.mock.timers.tick(1000);assert.equal(calls.length,0);focused=true;modal=true;win.dispatchEvent(new Event('focus'));t.mock.timers.tick(1000);assert.equal(calls.length,0);modal=false;doc.visibilityState='hidden';doc.dispatchEvent(new Event('visibilitychange'));t.mock.timers.tick(1000);assert.equal(calls.length,0);doc.visibilityState='visible';doc.dispatchEvent(new Event('visibilitychange'));t.mock.timers.tick(500);t.mock.timers.tick(400);assert.equal(calls.length,1);await Promise.resolve();await Promise.resolve();t.mock.timers.tick(500);t.mock.timers.tick(400);await Promise.resolve();await Promise.resolve();assert.ok(calls.length>=2);assert.ok(calls.every(ids=>ids.length<=100));const count=calls.length;win.dispatchEvent(new Event('authchange'));t.mock.timers.tick(5000);assert.equal(calls.length,count)}finally{cleanup();Object.assign(globalThis,old);t.mock.timers.reset()}
});
