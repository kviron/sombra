import assert from 'node:assert/strict';
import {test} from 'node:test';
import {newDirectMessages} from './ui/app/new-direct-messages.ts';

test('only unseen incoming messages in personal dialogs trigger notifications',()=>{
 const state={
  me:{id:'me'},
  users:[{id:'me',name:'Я'},{id:'guest',name:'Мария',avatar:'data:image/png;base64,YQ=='}],
  dialogs:[{id:'dialog'}],
  messages:[{id:'history',channel:'dialog',user:'guest',text:'Старое сообщение'}],
 };
 const seen=new Set();
 assert.deepEqual(newDirectMessages(state,seen,true),[]);
 state.messages.push(
  {id:'self',channel:'dialog',user:'me',text:'Моё сообщение'},
  {id:'group',channel:'group',user:'guest',text:'Сообщение в канале'},
  {id:'incoming',channel:'dialog',user:'guest',text:'Привет!'},
 );
 assert.deepEqual(newDirectMessages(state,seen),[
  {id:'incoming',sender:'Мария',avatar:'data:image/png;base64,YQ==',text:'Привет!'},
 ]);
 assert.deepEqual(newDirectMessages(state,seen),[]);
});
