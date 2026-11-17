import test from 'node:test';
import assert from 'node:assert/strict';
import {validNotificationTarget,notificationRoute} from './ui/app/notification-target.ts';
const target={account:'me',channel:'dm',message:'m-1'};
const state={me:{id:'me'},dialogs:[{id:'dm',members:['me','peer']}],groups:[{id:'g',members:['me'],channels:[{id:'text'},{id:'voice'}]}],messages:[{id:'m-1',channel:'dm'},{id:'m-2',channel:'text'}]};
test('bounded closed target rejects malformed and URL/script payloads',()=>{
 assert.ok(validNotificationTarget(target));
 for(const v of [null,[],{}, {...target,extra:true},{...target,account:1},{...target,channel:'sombra://chat/dm'},{...target,message:'x'.repeat(129)},{...target,message:''},{...target,channel:'../dm'},{...target,channel:'dm\n'}])assert.equal(validNotificationTarget(v),false);
});
test('DM, text and voice resolve by current membership without joining voice',()=>{
 assert.deepEqual(notificationRoute(state,target),{home:true,channel:'dm',group:undefined,message:'m-1'});
 assert.deepEqual(notificationRoute(state,{...target,channel:'text',message:'m-2'}),{home:false,channel:'text',group:'g',message:'m-2'});
 assert.equal(notificationRoute(state,{...target,channel:'voice'}).group,'g');
});
test('old account and revoked membership never route even for identical channel IDs',()=>{
 assert.equal(notificationRoute(state,{...target,account:'another'}),null);
 assert.equal(notificationRoute({...state,dialogs:[]},target),null);
 assert.equal(notificationRoute({...state,dialogs:[{id:'dm',members:['other']} ]},target),null);
 assert.equal(notificationRoute({...state,groups:[{...state.groups[0],members:[]}]},{...target,channel:'text'}),null);
});
test('deleted or cross-channel message does not highlight an unrelated message',()=>{
 assert.equal(notificationRoute(state,{...target,message:'gone'}).message,undefined);
 assert.equal(notificationRoute(state,{...target,message:'m-2'}).message,undefined);
 assert.equal(notificationRoute(state,{...target,channel:'gone'}),null);
});
