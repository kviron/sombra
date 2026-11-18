import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';

// Render the actual component without a DOM/network. Only native integration
// and CSS imports are stubbed; the real Markdown/GFM plugins and URL policy run.
const source=await readFile(new URL('./ui/app/message-text.tsx',import.meta.url),'utf8');
let compiled=ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
compiled=compiled.replace(/import\s+['"]\.\/[^'"]+\.css['"];?/g,'');
compiled=compiled.replace(/from\s+(['"])([^'"]+)\1/g,(_,quote,name)=>{
 let resolved;
 if(name==='@/shared/api')resolved='data:text/javascript,export const isTauri=()=>false;export const openExternal=async()=>{}';
 else if(name==='@/shared/lib/message-links')resolved=new URL('./ui/shared/lib/message-links.ts',import.meta.url).href;
 else if(name==='./user-actions')resolved='data:text/javascript,export const useUserActions=()=>({openProfile:()=>{}})';
 else if(name==='./message-mentions')resolved=new URL('./ui/app/message-mentions.ts',import.meta.url).href;
 else if(name==='./message-markdown-links')resolved=new URL('./ui/app/message-markdown-links.ts',import.meta.url).href;
 else resolved=import.meta.resolve(name);
 return `from ${JSON.stringify(resolved)}`;
});
const {MessageText}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
const render=(text,mentions)=>renderToStaticMarkup(createElement(MessageText,{text,mentions}));
const anchors=html=>[...html.matchAll(/<a\s[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gs)].map(match=>({href:match[1],text:match[2]}));

test('server-verified UTF16 mentions render profile buttons only in literal prose',()=>{
 const text='😀 привет @LordDevil и **@Other**';
 const start=text.indexOf('@LordDevil');
 const html=render(text,[{userId:'immutable-user',start,end:start+10}]);
 assert.match(html,/<button[^>]*class="message-mention"/);assert.match(html,/>@LordDevil<\/button>/);
 assert.doesNotMatch(render(text),/message-mention/);
 for(const body of ['`@LordDevil`','```\n@LordDevil\n```','[@LordDevil](https://example.org)','\\\\@LordDevil','person@LordDevil.org']){
  const offset=body.indexOf('@LordDevil');
  // Server excludes emails; supplying no metadata models its authoritative rejection.
  const metadata=body.startsWith('person')?[]:[{userId:'immutable-user',start:offset,end:offset+10}];
  assert.doesNotMatch(render(body,metadata),/message-mention/);
 }
 assert.doesNotMatch(html,/<a[^>]*>.*<button/s);
});

test('mentions inside lists, tables and emphasis keep structure; broken ranges are ignored',()=>{
 const text='- пункт @Ann\n- второй\n\n| кто | примечание |\n| --- | --- |\n| @Ann | ссылка |\n\n**@Ann** и `@Ann`';
 const at=[...text.matchAll(/@Ann/g)].map(match=>match.index),ranges=at.map(start=>({userId:'ann',start,end:start+4}));
 const html=render(text,ranges);
 assert.equal((html.match(/class="message-mention"/g)||[]).length,3);
 assert.match(html,/<ul>[\s\S]*class="message-mention"[\s\S]*<\/ul>/);
 assert.match(html,/<table>[\s\S]*class="message-mention"[\s\S]*<\/table>/);
 assert.match(html,/<strong><button[^>]*class="message-mention"[^>]*>@Ann<\/button><\/strong>/);
 assert.doesNotMatch(html,/<code>[^<]*<button/);
 const link='см. [сайт](https://@Ann.example)';
 assert.doesNotMatch(render(link,[{userId:'ann',start:link.indexOf('@Ann'),end:link.indexOf('@Ann')+4}]),/message-mention/);
 for(const [label,bad,want] of [
  ['not an @',[{userId:'ann',start:at[0]+1,end:at[0]+4}],0],
  ['past the end',[{userId:'ann',start:at[0],end:at[0]+400}],0],
  ['empty range',[{userId:'ann',start:at[0],end:at[0]}],0],
  ['reversed range',[{userId:'ann',start:at[0],end:at[0]-2}],0],
  ['missing identity',[{userId:'',start:at[0],end:at[0]+4}],0],
  ['overlapping rows',[{userId:'ann',start:at[0],end:at[0]+4},{userId:'ann',start:at[0]+2,end:at[0]+6}],1],
 ])assert.equal((render(text,bad).match(/class="message-mention"/g)||[]).length,want,label);
});

test('actual renderer supports CommonMark emphasis, GFM and literal code',()=>{
 const html=render('***Юникод жирный курсив*** ~~старое~~\n\n- первый\n- [x] готово\n\n> цитата\n\n```html\n<script>bad()</script>\n```\n\n`<img src=x onerror=bad()>`');
 assert.match(html,/<(?:em><strong|strong><em)>Юникод жирный курсив/);
 assert.match(html,/<del>старое<\/del>/);assert.match(html,/<ul(?:\s|>)/);assert.match(html,/<blockquote>/);
 assert.match(html,/<input[^>]*disabled=""[^>]*checked=""/);
 assert.match(html,/&lt;script&gt;bad\(\)&lt;\/script&gt;/);
 assert.doesNotMatch(html,/<script|<img/);
});
test('safe legacy labels, balanced URL paths, IPv6 and canonical targets survive',()=>{
 for(const label of ['Help','OpenAI Help Center','help.openai.com']){
  assert.deepEqual(anchors(render(`${label} (https://example.com/a?q=1)`)),[{href:'https://example.com/a?q=1',text:label}]);
 }
 assert.equal(anchors(render('[Wiki](https://en.wikipedia.org/wiki/Function_(mathematics))'))[0].href,'https://en.wikipedia.org/wiki/Function_(mathematics)');
 assert.equal(anchors(render('[IPv6](http://[::1]:3000/a)'))[0].href,'http://[::1]:3000/a');
 assert.deepEqual(anchors(render('www.example.com help.openai.com')).map(link=>link.href),['https://www.example.com/','https://help.openai.com/']);
 assert.equal(anchors(render('`https://example.com`\n\n```text\nhttps://example.com\n```')).length,0);
 assert.match(render('[ok](HTTPS://EXAMPLE.COM)'),/target="_blank" rel="noopener noreferrer"/);
});
test('forbidden links and nested scheme hosts never become anchors',()=>{
 for(const value of ['javascript:alert(https://example.com)','data:text/html,https://example.com','file://www.example.com/a','mailto:user@example.com','user@example.com','https://user:secret@example.com','[x](JaVaScRiPt:alert%281%29)','[x](javascript%3Aalert%281%29)','[x](data:text/html,https://example.com)','[x](file:///private)','[x](mailto:private@example.com)','[x](java&#x09;script:alert%281%29)','[x](//example.com)'])assert.equal(anchors(render(value)).length,0,value);
});
test('raw HTML cannot create nodes and Markdown images never load anything',()=>{
 const html=render('<script>window.bad=1</script>\n\n<img src="https://track.invalid/pixel" onerror="bad()">\n\n![описание](https://track.invalid/pixel)\n\n![x](data:image/svg+xml,bad)');
 assert.doesNotMatch(html,/<script|<img|onerror=|src="/);
 assert.match(html,/Изображение: описание/);
});
test('line breaks, tables and normal URLs remain semantic and contained',()=>{
 const html=render('строка один\nстрока два\n\n| Имя | Значение |\n| --- | --- |\n| тест | **да** |\n\nhttps://example.com');
 assert.match(html,/строка один\nстрока два/);assert.match(html,/class="message-table-scroll"/);assert.match(html,/<table>/);assert.match(html,/<strong>да<\/strong>/);assert.equal(anchors(html).length,1);
});
