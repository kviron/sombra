import assert from 'node:assert/strict';
import {test} from 'node:test';
import {normalizeLinkUrl,parseMessageLinks} from './ui/shared/lib/message-links.ts';
const links=text=>parseMessageLinks(text).filter(part=>part.type==='link');

test('explicit HTTP(S), bare domains and full query strings',()=>{
 assert.deepEqual(links('https://example.com/a?q=1&b=2 http://example.org help.openai.com www.example.com').map(p=>p.href),['https://example.com/a?q=1&b=2','http://example.org/','https://help.openai.com/','https://www.example.com/']);
});
test('Markdown and user label formats produce exactly one anchor',()=>{
 const url='https://help.openai.com/en/articles/123?utm_source=openai';
 for(const label of ['help.openai.com','Help','OpenAI Help Center']) {
  for(const input of [`${label} (${url})`,`[${label}](${url})`])assert.deepEqual(links(input),[{type:'link',text:label,href:url}]);
 }
 assert.deepEqual(links('[A \\[label\\] \\\\ name](https://example.com)'),[{type:'link',text:'A [label] \\ name',href:'https://example.com/'}]);
});
test('sentence punctuation and balanced Wikipedia parentheses',()=>{
 assert.deepEqual(links('(https://en.wikipedia.org/wiki/Function_(mathematics)). example.com, https://example.com/a!').map(p=>p.text),['https://en.wikipedia.org/wiki/Function_(mathematics)','example.com','https://example.com/a']);
 assert.equal(links('[Wiki](https://en.wikipedia.org/wiki/Function_(mathematics))')[0].href,'https://en.wikipedia.org/wiki/Function_(mathematics)');
});
test('whitespace, HTML and non-link text are preserved exactly',()=>{
 const text='  before\n\t<script>alert(1)</script> & <img src=x>\n after  ';
 assert.deepEqual(parseMessageLinks(text),[{type:'text',text}]);
 const mixed=' \nhttps://example.com\t end\n';
 assert.equal(parseMessageLinks(mixed).map(p=>p.text).join(''),mixed);
});
test('dangerous schemes never partially autolink embedded hosts',()=>{
 for(const value of ['javascript:help.openai.com','javascript:alert(https://example.com)',"javascript:window.open('https://example.com')",'data:text/html,<a>https://example.com</a>','data:text/html,https://example.com','file://www.example.com/a','vbscript:https://example.com','ftp://example.com','mailto:user@example.com','https://user:secret@example.com','https://@example.com','https://user@example.com','https://example.com\\@evil.com','user@example.com','person+tag@help.openai.com'])assert.equal(links(value).length,0,value);
 for(const value of ['javascript:alert(1)','data:text/html,x','file:///tmp','//example.com','https://user:pass@example.com','https://@example.com','https://example.com\n.evil',' https://example.com','https://example.com\\evil'])assert.equal(normalizeLinkUrl(value),null,value);
 for(const value of ['[label](javascript:https://example.com)','[label](data:text/html,https://example.com)','[label](https://user:pass@example.com)'])assert.deepEqual(parseMessageLinks(value),[{type:'text',text:value}]);
});
test('normalizer contract and malformed inputs',()=>{
 assert.equal(normalizeLinkUrl('https://example.com/a?q=one%20two#hash'),'https://example.com/a?q=one%20two#hash');
 assert.equal(normalizeLinkUrl('help.openai.com'),null);
 for(const value of ['','https://','http://[','foo..com','-foo.com','example.com@evil.com'])assert.equal(links(value).length,0,value);
});
