import test from 'node:test';
import assert from 'node:assert/strict';
import {newChatMessages,createChatNotificationCursor,batchChatNotifications,notificationEligible} from './ui/app/new-chat-messages.ts';
import {newDirectMessages} from './ui/app/new-direct-messages.ts';
const start=1800000000000;
const me={id:'me',name:'Me'};
const user={id:'other',name:'Автор'};
const dialog={id:'dm',name:'Личное',members:['me','other']};
const group={id:'g',name:'Группа',channels:[{id:'text',name:'текст',kind:'text'},{id:'voice',name:'голос',kind:'voice'}]};
const state=(messages=[],extra={})=>({me,users:[me,user],dialogs:[dialog],groups:[group],messages,...extra});
const msg=(id,channel='dm',extra={})=>({id,channel,user:'other',text:id,time:start/1000,...extra});
const baseline=(s=state())=>{const cursor=createChatNotificationCursor('me');assert.deepEqual(newChatMessages(s,cursor,start),[]);return cursor;};
test('initial history, self, unique IDs, text and voice channels',()=>{
 const cursor=baseline(state([msg('old')]));
 const s=state([msg('old'),msg('self','dm',{user:'me'}),msg('t','text'),msg('v','voice'),msg('v','voice')]);
 const incoming=newChatMessages(s,cursor,start+1000);
 assert.equal(incoming.length,2);assert.equal(incoming[0].sender,'Группа · #текст · Автор');assert.equal(incoming[1].sender,'Группа · #голос · Автор');
 assert.deepEqual(newChatMessages(s,cursor,start+2000),[]);
});
test('muted, direct/groups master settings consume all without replay; pin has no effect',()=>{
 for(const chatPreferences of [{notifications:{direct:false,groups:false}},{dialogs:{dm:{muted:true},text:{muted:true}}}]){
  const cursor=baseline();const messages=[msg('d'),msg('g','text')];
  assert.deepEqual(newChatMessages(state(messages,{chatPreferences}),cursor,start+1000),[]);
  assert.deepEqual(newChatMessages(state(messages,{chatPreferences:{}}),cursor,start+2000),[]);
  assert.equal(newChatMessages(state([msg('pin')],{chatPreferences:{dialogs:{dm:{pinned:true}}}}),cursor,start+3000).length,1);
 }
 const cursor=baseline();assert.equal(newChatMessages(state([msg('d'),msg('g','text')],{chatPreferences:{notifications:{groups:false}}}),cursor,start+1000).length,1);
});
test('newly joined groups baseline entirely; newly created DM requires reliable recent time',()=>{
 const cursor=baseline(state([],{groups:[],dialogs:[]}));
 const incoming=newChatMessages(state([msg('old-group','text'),msg('fresh-group','voice'),msg('old-dm','dm',{time:1}),msg('unknown','dm',{time:NaN}),msg('fresh')]),cursor,start+1000);
 assert.deepEqual(incoming.map(m=>m.id),['fresh']);
 assert.equal(newChatMessages(state([msg('next','text')]),cursor,start+2000).length,1);
});
test('new channel inside an existing group notifies only reliable recent messages',()=>{
 const cursor=baseline();
 const groups=[{...group,channels:[...group.channels,{id:'new-channel',name:'новый',kind:'voice'}]}];
 const messages=[msg('old-channel-history','new-channel',{time:1}),msg('unknown-channel-time','new-channel',{time:NaN}),msg('fresh-channel','new-channel')];
 assert.deepEqual(newChatMessages(state(messages,{groups}),cursor,start+1000).map(item=>item.id),['fresh-channel']);
 assert.deepEqual(newChatMessages(state(messages,{groups}),cursor,start+2000),[]);
});
test('account switch rebaselines and no browser storage is accessed',()=>{
 // A browser storage fingerprint must not change, nor may helpers mutate state snapshots.
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
 const storage=new Map([['notification-settings','sentinel']]);
 const fingerprint=JSON.stringify([...storage]);
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)}});
 const cursor=baseline();const snapshot=state([msg('one')]);const before=JSON.stringify(snapshot);
 try{newChatMessages(snapshot,cursor,start+1000);assert.equal(JSON.stringify(snapshot),before);assert.equal(JSON.stringify([...storage]),fingerprint);}
 finally{if(descriptor)Object.defineProperty(globalThis,'localStorage',descriptor);else delete globalThis.localStorage;}
 assert.deepEqual(newChatMessages(state([msg('two')],{me:{...me,id:'another'}}),cursor,start+2000),[]);
 assert.equal(cursor.user,'another');assert.equal(cursor.seen.has('one'),false);
});
test('attachment, sticker, group DM context, and 220-codepoint Unicode previews',()=>{
 const cursor=baseline();const incoming=newChatMessages(state([
  msg('a','dm',{text:'',attachment:{name:'photo.png'}}),msg('s','dm',{text:' ',sticker:'x'}),msg('u','dm',{text:'😀'.repeat(230)})
 ],{dialogs:[{...dialog,name:'Команда',members:['me','other','third']}]}),cursor,start+1000);
 assert.equal(incoming[0].sender,'Команда · Автор');assert.equal(incoming[0].text,'Файл: photo.png');assert.equal(incoming[1].text,'Стикер');assert.equal(Array.from(incoming[2].text).length,220);assert.ok(incoming[2].text.endsWith('…'));
});
test('batch caps five chats and aggregates latest previews, but consumes every ID',()=>{
 const dialogs=Array.from({length:8},(_,i)=>({...dialog,id:`d${i}`}));const cursor=baseline(state([],{dialogs}));
 const messages=dialogs.flatMap(d=>[msg(`${d.id}-1`,d.id),msg(`${d.id}-2`,d.id)]);
 const batch=batchChatNotifications(newChatMessages(state(messages,{dialogs}),cursor,start+1000));
 assert.equal(batch.length,5);assert.equal(batch[0].count,2);assert.ok(batch[0].sender.includes('2 новых сообщений'));assert.equal(cursor.seen.size,16);
 assert.deepEqual(newChatMessages(state(messages,{dialogs}),cursor,start+2000),[]);
});
test('foreground eligibility matrix',()=>{
 assert.equal(notificationEligible('dm','dm',false,true,true),false);
 for(const args of [['dm','dm',false,false,true],['dm','dm',false,true,false],['dm','other',false,true,true],['dm','dm',true,true,true]])assert.equal(notificationEligible(...args),true);
});
test('legacy direct helper API remains unchanged',()=>{
 const seen=new Set();assert.deepEqual(newDirectMessages(state([msg('old')]),seen,true),[]);
 assert.equal(newDirectMessages(state([msg('old'),msg('new'),msg('group','text')]),seen).length,1);
});
