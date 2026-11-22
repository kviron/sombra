import test from 'node:test';
import assert from 'node:assert/strict';
import {attachmentDownloadFailure} from './attachment-errors.ts';
test('auth failures end the session with one clear message',()=>{
 for(const reason of [new Error('AUTH_REQUIRED'),new Error('REMOTE_UNAVAILABLE: AUTH_REQUIRED: x'),'AUTH_REQUIRED']){
  const failure=attachmentDownloadFailure(reason,'Не удалось скачать файл.');
  assert.equal(failure.authRequired,true);
  assert.equal(failure.message,'Сессия завершена. Войдите снова.');
 }
});
test('transport prefixes are stripped and server text is kept',()=>{
 assert.deepEqual(attachmentDownloadFailure(new Error('REMOTE_UNAVAILABLE: Сеть недоступна'),'fallback'),{message:'Сеть недоступна',authRequired:false});
 assert.deepEqual(attachmentDownloadFailure('Файл больше недоступен','fallback'),{message:'Файл больше недоступен',authRequired:false});
});
test('empty, non-string and unknown failures use the caller fallback',()=>{
 for(const reason of [new Error(''),'   ',undefined,null,42,{}]){
  assert.deepEqual(attachmentDownloadFailure(reason,'Не удалось скачать файл.'),{message:'Не удалось скачать файл.',authRequired:false});
 }
});
