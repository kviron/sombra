import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import {editMentionDraft,trimmedDraftText,trimmedDraftMentions,mentionSendPayload} from './ui/app/draft-mentions.ts';
import {newChatMessages,createChatNotificationCursor} from './ui/app/new-chat-messages.ts';

const alice={id:'alice',name:'Alice',username:'alice'},bob={id:'bob',name:'Bob B'},carol={id:'carol',name:'Carol'};
const members=[alice,bob];
/** Mirrors the composer's replacement: the typed `@query` span becomes the selected alias token. */
function insert(draft,offset,endOffset,token,userId){
 const after=draft.text.slice(endOffset),text=draft.text.slice(0,offset)+token+(after.startsWith(' ')?after:' '+after);
 const kept=editMentionDraft(draft,text).mentions.filter(m=>m.end<=offset||m.start>=offset+token.length);
 return {text,mentions:[...kept,{userId,start:offset,end:offset+token.length}]};
}

test('draft spans survive edits outside the token and are revoked by any edit inside it',()=>{
 const base={text:'Привет @Alice, как дела?',mentions:[{userId:'alice',start:7,end:13}]};
 assert.equal(editMentionDraft(base,base.text),base);
 assert.deepEqual(editMentionDraft(base,'Привет @Alice, как дела??').mentions,[{userId:'alice',start:7,end:13}]);
 assert.deepEqual(editMentionDraft(base,'Привет и @Alice, как дела?').mentions,[{userId:'alice',start:9,end:15}]);
 assert.deepEqual(editMentionDraft(base,'Привет @AlicX, как дела?').mentions,[]);
 assert.deepEqual(editMentionDraft(base,'Привет , как дела?').mentions,[]);
 const emoji={text:'😀 @Alice',mentions:[{userId:'alice',start:3,end:9}]};
 assert.equal(emoji.text.slice(3,9),'@Alice');
 assert.deepEqual(editMentionDraft(emoji,'😀 !@Alice').mentions,[{userId:'alice',start:4,end:10}]);
});

test('trim uses the exact server whitespace so UTF-16 offsets cannot drift',()=>{
 assert.equal(trimmedDraftText('  @Alice \uFEFF'),'@Alice');
 assert.equal(trimmedDraftText('\u0085@Alice\u0085'),'@Alice');
 assert.deepEqual(trimmedDraftMentions({text:' @Alice',mentions:[{userId:'alice',start:1,end:7}]},' @Alice'),[{userId:'alice',start:0,end:6}]);
 assert.deepEqual(trimmedDraftMentions({text:'@Alice ',mentions:[{userId:'alice',start:0,end:6}]},'@Alice '),[{userId:'alice',start:0,end:6}]);
});

test('wire payload trims text, shifts spans and drops anything the server would reject',()=>{
 const draft={text:'   @Alice привет  ',mentions:[{userId:'alice',start:3,end:9}]};
 assert.deepEqual(mentionSendPayload(draft,draft.text,members),{text:'@Alice привет',mentions:[{userId:'alice',start:0,end:6}]});
 // The selected alias is no longer what the text says (typed directly after it).
 assert.deepEqual(mentionSendPayload({text:'@AliceX hi',mentions:[{userId:'alice',start:0,end:7}]},'@AliceX hi',members).mentions,[]);
 assert.deepEqual(mentionSendPayload({text:'x@Alice',mentions:[{userId:'alice',start:1,end:7}]},'x@Alice',members).mentions,[]);
 assert.deepEqual(mentionSendPayload({text:'@Alice, hi',mentions:[{userId:'alice',start:0,end:6}]},'@Alice, hi',members).mentions,[{userId:'alice',start:0,end:6}]);
 assert.deepEqual(mentionSendPayload({text:'@Alice9',mentions:[{userId:'alice',start:0,end:6}]},'@Alice9',members).mentions,[]);
 // Renamed/kicked participant or invented range is not sent.
 assert.deepEqual(mentionSendPayload({text:'@Света',mentions:[{userId:'carol',start:0,end:6}]},'@Света',members).mentions,[]);
 assert.deepEqual(mentionSendPayload({text:'@Alice',mentions:[{userId:'alice',start:0,end:60}]},'@Alice',members).mentions,[]);
 assert.deepEqual(mentionSendPayload({text:'@Alice hi',mentions:[{userId:'alice',start:0,end:6},{userId:'alice',start:3,end:9}]},'@Alice hi',members).mentions,[{userId:'alice',start:0,end:6}]);
 // Bots/users may have spaces in the display alias; UTF-16 offsets include surrogate pairs.
 assert.deepEqual(mentionSendPayload({text:'😀 @Bob B',mentions:[{userId:'bob',start:3,end:9}]},'😀 @Bob B',[bob]).mentions,[{userId:'bob',start:3,end:9}]);
 const unicode=mentionSendPayload({text:'\u0085 @Bob B',mentions:[{userId:'bob',start:2,end:8}]},'\u0085 @Bob B',[bob]);
 assert.deepEqual(unicode,{text:'@Bob B',mentions:[{userId:'bob',start:0,end:6}]});
 // Boundary rules mirror the server: NBSP counts as whitespace, U+FEFF and word characters do not.
 assert.deepEqual(mentionSendPayload({text:'\u00A0@Alice',mentions:[{userId:'alice',start:1,end:7}]},'\u00A0@Alice',members).mentions,[{userId:'alice',start:0,end:6}]);
 assert.deepEqual(mentionSendPayload({text:'a\uFEFF@Alice',mentions:[{userId:'alice',start:2,end:8}]},'a\uFEFF@Alice',members).mentions,[]);
 assert.deepEqual(mentionSendPayload({text:'@Alice\u0301',mentions:[{userId:'alice',start:0,end:6}]},'@Alice\u0301',members).mentions,[]);
 assert.deepEqual(mentionSendPayload({text:'@Alice😀',mentions:[{userId:'alice',start:0,end:6}]},'@Alice😀',members).mentions,[{userId:'alice',start:0,end:6}]);
 // Building the payload must never mutate the stored draft, so a failed send keeps its spans.
 const kept={text:' @Alice',mentions:[{userId:'alice',start:1,end:7}]};
 const before=JSON.stringify(kept);mentionSendPayload(kept,kept.text,members);
 assert.equal(JSON.stringify(kept),before);
});

test('menus insert usernames and the recorded span matches the sent text',()=>{
 const typed='Привет, @Bo как дела?',offset=typed.indexOf('@Bo'),endOffset=offset+3;
 let draft={text:typed,mentions:[]};
 draft=insert(draft,offset,endOffset,'@Bob B','bob');
 assert.equal(draft.text,'Привет, @Bob B как дела?');
 const payload=mentionSendPayload(draft,draft.text,members);
 assert.equal(payload.text.slice(payload.mentions[0].start,payload.mentions[0].end),'@Bob B');
 assert.equal(payload.mentions[0].userId,'bob');
 const after=draft.text+' ещё';
 assert.deepEqual(mentionSendPayload(draft,after,members).mentions,payload.mentions);
 const edited=insert(draft,offset,endOffset+6,'@Bob C','bob');
 assert.deepEqual(mentionSendPayload(edited,edited.text,members).mentions,[]);
 // Two insertions with ordinary typing between keep both spans aligned.
 let two=insert({text:'@Al hi',mentions:[]},0,3,'@Alice','alice');
 const typedAgain=two.text+' @Bo';
 two=insert({text:typedAgain,mentions:two.mentions},typedAgain.length-3,typedAgain.length,'@Bob B','bob');
 const both=mentionSendPayload(two,two.text,members);
 assert.deepEqual(both.mentions.map(({userId,start,end})=>[userId,both.text.slice(start,end)]),[['alice','@Alice'],['bob','@Bob B']]);
});

test('addressed notifications name the mention but keep the sender, chat and target',()=>{
 const me={id:'me',name:'Me'},sender={id:'other',name:'Отправитель'};
 const dialog={id:'dm',name:'Личное',members:['me','other']};
 const group={id:'g',name:'Группа',channels:[{id:'text',name:'канал',kind:'text'}]};
 const msg=(id,channel,extra={})=>({id,channel,user:'other',text:id,time:1800000000,...extra});
 const state=messages=>({me,users:[me,sender,alice],dialogs:[dialog],groups:[group],messages});
 const cursor=createChatNotificationCursor('me');
 newChatMessages(state([msg('old','dm')]),cursor,1800000000000);
 const rows=newChatMessages(state([msg('old','dm'),msg('a','dm',{mentions:[{userId:'me',start:0,end:3}]}),msg('b','dm'),msg('c','text',{mentions:[{userId:'alice',start:0,end:6}]})]),cursor,1800000001000);
 assert.deepEqual(rows.map(row=>row.sender),['Вас упомянули · Отправитель','Отправитель','Группа · #канал · Отправитель']);
 assert.deepEqual(rows.map(row=>row.channel),['dm','dm','text']);
 assert.equal(rows[0].id,'a');
});

test('unread mention badge stays compact and silent when the count is not positive',async()=>{
 const source=await readFile(new URL('./ui/app/unread-mention-badge.tsx',import.meta.url),'utf8');
 let compiled=ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 compiled=compiled.replace(/import\s+['"]\.\/[^'"]+\.css['"];?/g,'');
 compiled=compiled.replace(/from\s+(['"])([^'"]+)\1/g,(_,quote,name)=>`from ${JSON.stringify(import.meta.resolve(name))}`);
 const {UnreadMentionBadge}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
 const render=count=>renderToStaticMarkup(createElement(UnreadMentionBadge,{count}));
 for(const count of [undefined,0,-1,NaN])assert.equal(render(count),'');
 const one=render(1);
 assert.match(one,/class="unread-mention-badge"/);assert.match(one,/>@<\/span>/);
 assert.match(one,/aria-label="Есть непрочитанные упоминания: 1"/);
 assert.match(render(2),/>@2</);assert.match(render(120),/>@99\+</);
});

test('verified mentions, badge and profile action stay wired into the chat surface',async()=>{
 const read=path=>readFile(new URL(path,import.meta.url),'utf8');
 const live=await read('./ui/app/live-chat.tsx'),row=await read('./ui/app/dialog-list-row.tsx'),extras=await read('./ui/app/chat-extras.tsx'),text=await read('./ui/app/message-text.tsx');
 assert.match(live,/<UnreadMentionBadge count=\{c\.unreadMentionCount\}\/>/);
 assert.match(live,/onMentionInserted=/);
 assert.match(live,/text:payload\.text,mentions:payload\.mentions/);
 assert.match(row,/<UnreadMentionBadge count=\{dialog\.unreadMentionCount\}\/>/);
 assert.match(extras,/<MessageText text=\{m\.text\} mentions=\{m\.mentions\}\/>/);
 assert.match(text,/actions\?\.openProfile\(id\)/);
 assert.doesNotMatch(text,/dangerouslySetInnerHTML/);
});
