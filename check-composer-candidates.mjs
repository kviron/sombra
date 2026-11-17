import assert from 'node:assert/strict';
import {test} from 'node:test';
import {composerTrigger,mentionCandidates,commandCandidates,localCommandCandidates} from './ui/app/composer-candidates.ts';
const state={me:{id:'me'},users:[{id:'me',name:'Я'},{id:'a',name:'Анна'},{id:'b',name:'Анна'},{id:'outsider',name:'Другой'},{id:'bot',name:'Сомбра',username:'hermes',bot:true}],dialogs:[{id:'dm',members:['me','a']},{id:'botdm',members:['me','bot']}],groups:[{id:'g',members:['me','a','b']}],bots:[{id:'bot',name:'Сомбра',username:'hermes',groups:['g'],enabled:true,commands:[{command:'help',description:'Справка'}]},{id:'off',name:'Выключен',groups:['g'],enabled:false,commands:[{command:'bad'}]}]};
test('caret fragment is bounded, midtext allowed and email rejected',()=>{
 assert.deepEqual(composerTrigger('Привет @Ан остаток','@',10),{query:'Ан',offset:7,endOffset:10});
 assert.equal(composerTrigger('mail@example.org','@',16),null);
 assert.equal(composerTrigger('test@Ан','@',7),null);
 assert.deepEqual(composerTrigger('/he tail','/',3),{query:'he',offset:0,endOffset:3});
 assert.equal(composerTrigger('hello /he','/',9),null);
 assert.equal(composerTrigger('@Ан','@',0),null);
});
test('DM candidates contain current members only, excluding self and global bots',()=>{
 assert.deepEqual(mentionCandidates(state,'dm').map(x=>x.id),['a']);
 assert.deepEqual(mentionCandidates(state,'botdm').map(x=>x.metadata.insert),['@hermes']);
});
test('group candidates union only scoped enabled bots with stable duplicate-name IDs',()=>{
 const rows=mentionCandidates(state,'channel','g');
 assert.deepEqual(rows.map(x=>x.id),['a','b','bot']);
 assert.equal(rows[0].metadata.insert,'@Анна');
 assert.equal(rows[2].metadata.insert,'@hermes');
 assert.notEqual(rows[0].description,rows[1].description);
});
test('local commands explicitly expose only safe implemented UI actions',()=>{
 assert.deepEqual(localCommandCandidates.map(x=>x.id),['local:search','local:clear']);
 assert.ok(localCommandCandidates.every(x=>x.type==='local-command'&&x.metadata.insert===''));
 assert.match(localCommandCandidates[1].description,/не историю и не вложение/);
});
test('slash commands preserve installed bot routing and never invent commands',()=>{
 assert.deepEqual(commandCandidates(state,'channel','g').map(x=>x.label),['/help@hermes']);
 assert.deepEqual(commandCandidates(state,'botdm').map(x=>x.label),['/help']);
 assert.deepEqual(commandCandidates(state,'dm'),[]);
});
