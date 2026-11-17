import assert from 'node:assert/strict';
import {test} from 'node:test';
import {findStickerSuggestions} from './ui/app/find-sticker-suggestions.ts';

const stickers=[
 {id:'personal',owner:'me',name:'Привет',keywords:['здравствуй','добрый день']},
 {id:'older',owner:'me',name:'Подмигивание'},
 {id:'group',owner:'admin',group:'team',name:'Махаю',keywords:['привет']},
 {id:'foreign',owner:'guest',name:'Привет'},
 {id:'other-group',owner:'me',group:'other',name:'Привет'},
 {id:'archived',owner:'me',name:'Привет',archived:true},
 {id:'phrase',owner:'me',name:'Сюрприз',keywords:['всем привет']},
 {id:'stress',owner:'me',name:'Жарко',keywords:['припёк']},
];
const matches=(draft,group)=>findStickerSuggestions(draft,stickers,'me',group).map(({sticker,replaceDraft})=>[sticker.id,replaceDraft]);
test('matches names and keyword aliases from the current library',()=>{
 assert.deepEqual(matches(' ПРИВЕТ! ','team'),[['personal',true],['group',true]]);
 assert.deepEqual(matches('здравствуй'),[['personal',true]]);
 assert.deepEqual(matches('добрый день.'),[['personal',true]]);
 assert.deepEqual(matches('подмигивание'),[['older',true]]);
 assert.deepEqual(matches('припек'),[['stress',true]]);
});
test('prioritizes the specific phrase, preserves other draft words and ignores partial words',()=>{
 assert.deepEqual(matches('Всем привет','team'),[['phrase',true],['personal',false],['group',false]]);
 assert.deepEqual(matches('Она сказала привет'),[['personal',false]]);
 assert.deepEqual(matches('суперпривет'),[]);
 assert.deepEqual(matches('прив'),[]);
});
