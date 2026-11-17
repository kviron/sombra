import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
// Pure exported byte helpers only: React/DOM effect behavior is covered by browser QA.
const source=readFileSync('ui/app/attachment-draft-preview.tsx','utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const exports={};
vm.runInNewContext(compiled,{exports,require:name=>{
 if(name==='./attachment-composer')return {MAX_ATTACHMENT_SIZE:10*1024*1024};
 if(['react','react/jsx-runtime','lucide-react','@/shared/ui/button','@/shared/lib/image-crop'].includes(name))return {};
 throw new Error('Unexpected helper dependency '+name);
},atob,Uint8Array});
const {decodeDraftBytes,draftImageMime,draftByteSize}=exports;
assert.equal(Buffer.from(decodeDraftBytes('YWJj')).toString(),'abc');
for(const value of ['data:text/plain;base64,YWJj','https://example.invalid/x','!!!=','A','AA=A'])assert.equal(decodeDraftBytes(value),null);
const cap=Buffer.alloc(10*1024*1024);assert.equal(decodeDraftBytes(cap.toString('base64')).length,cap.length);
assert.equal(decodeDraftBytes(Buffer.alloc(cap.length+1).toString('base64')),null);
for(const [bytes,mime] of [[[137,80,78,71,13,10,26,10],'image/png'],[[255,216,255],'image/jpeg'],[[71,73,70,56,57,97],'image/gif']])assert.equal(draftImageMime(Uint8Array.from(bytes)),mime);
assert.equal(draftImageMime(Buffer.from('<svg/>')),undefined);assert.equal(draftImageMime(Buffer.from('<html/>')),undefined);
assert.equal(draftByteSize(3),'3 Б');assert.equal(draftByteSize(1024),'1.0 КБ');
console.log('PASS preview helpers: raw base64, exact 10 MiB, over-cap, safe magic, SVG/HTML exclusion, size');
