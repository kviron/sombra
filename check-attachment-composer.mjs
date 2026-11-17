import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source=readFileSync(new URL('./ui/app/attachment-composer.tsx',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function helpers(){
 const exports={};
 class FileReader {
  readAsDataURL(file){this.result=`data:${file.type||'application/octet-stream'};base64,${Buffer.from(file.content||'').toString('base64')}`;this.onload()}
 }
 vm.runInNewContext(compiled,{exports,require:()=>({}),FileReader});
 return exports;
}
test('reads raw base64 and preserves file metadata',async()=>{
 const {readAttachment}=helpers();
 const draft=await readAttachment({name:'report.txt',size:3,type:'text/plain',content:'abc'});
 assert.equal(draft.name,'report.txt');assert.equal(draft.data,'YWJj');assert.equal(draft.mime,'text/plain');
});
test('rejects above 10 MiB before reading; allows exact cap',async()=>{
 const {readAttachment,MAX_ATTACHMENT_SIZE}=helpers();
 await assert.rejects(readAttachment({size:MAX_ATTACHMENT_SIZE+1}),/10 МиБ/);
 assert.equal((await readAttachment({name:'file',size:MAX_ATTACHMENT_SIZE,type:'',content:''})).data,'');
});
test('file paste is intercepted, ordinary text paste is preserved',()=>{
 const {pastedAttachment}=helpers();let prevented=0;const file={name:'image.png'};
 assert.equal(pastedAttachment({clipboardData:{files:[file]},preventDefault(){prevented++}}),file);
 assert.equal(prevented,1);
 assert.equal(pastedAttachment({clipboardData:{files:[]},preventDefault(){prevented++}}),undefined);
 assert.equal(prevented,1);
});
