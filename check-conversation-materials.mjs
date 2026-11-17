import assert from 'node:assert/strict';
import {test} from 'node:test';
import {attachmentCategory,conversationMaterials,filterMaterials} from './ui/shared/lib/conversation-materials.ts';
const message=(id,channel,text,time=100,attachment)=>({id,channel,text,time,user:'guest',...(attachment?{attachment}:{})});
test('classifies media MIME and legacy octet-stream extensions without executing content',()=>{
 for(const [name,mime,category] of [['A.PNG','application/octet-stream','photos'],['a.webm','application/octet-stream','videos'],['a.WAV','application/octet-stream','audio'],['a','video/mp4','videos'],['a','audio/mpeg','audio'],['a.svg','image/svg+xml','files'],['report.html','text/html','files']])assert.equal(attachmentCategory(name,mime),category);
});
test('indexes only the current conversation; no external fetch; keeps expired metadata',()=>{
 const file={id:'file',name:'picture.png',mime:'image/png',size:20,expired:true};
 const result=conversationMaterials([message('a','room','https://example.com',100,file),message('b','other','https://private.example',101)],'room');
 assert.equal(result.length,2);assert.ok(result.every(item=>item.message.channel==='room'));assert.equal(result.find(item=>item.category==='photos').message.attachment.expired,true);
});
test('normalizes safe links, deduplicates within a message and keeps separate messages',()=>{
 const result=conversationMaterials([message('a','room','[Документы](https://example.com) https://example.com javascript:alert(1)',100),message('b','room','example.com',101)],'room');
 assert.equal(result.length,2);assert.equal(result[0].message.id,'b');assert.equal(result[1].title,'Документы');assert.ok(result.every(item=>item.href==='https://example.com/'));
});
test('searches category, filename, text, URL and author case-insensitively',()=>{
 const items=conversationMaterials([message('a','r','Обсуждение',100,{id:'f',name:'Проект.ZIP',mime:'application/octet-stream',size:10}),message('b','r','[Справка](https://help.example.com)',101)],'r');
 assert.equal(filterMaterials(items,'files',' проект ',()=> 'Мария').length,1);
 assert.equal(filterMaterials(items,'all','МАРИЯ',()=> 'Мария').length,2);
 assert.equal(filterMaterials(items,'links','help.example',()=> '').length,1);
 assert.equal(filterMaterials(items,'audio','',()=> '').length,0);
});
