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
compiled=compiled.replace(/import\s+['"]\.\/message-text\.css['"];?/g,'');
compiled=compiled.replace(/from\s+(['"])([^'"]+)\1/g,(_,quote,name)=>{
 let resolved;
 if(name==='@/shared/api')resolved='data:text/javascript,export const isTauri=()=>false;export const openExternal=async()=>{}';
 else if(name==='@/shared/lib/message-links')resolved=new URL('./ui/shared/lib/message-links.ts',import.meta.url).href;
 else if(name==='./message-markdown-links')resolved=new URL('./ui/app/message-markdown-links.ts',import.meta.url).href;
 else resolved=import.meta.resolve(name);
 return `from ${JSON.stringify(resolved)}`;
});
const {MessageText}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
const render=text=>renderToStaticMarkup(createElement(MessageText,{text}));
const anchors=html=>[...html.matchAll(/<a\s[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gs)].map(match=>({href:match[1],text:match[2]}));

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
