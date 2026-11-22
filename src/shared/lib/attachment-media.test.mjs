import {test} from 'node:test';
import assert from 'node:assert/strict';
import {verifiedMediaBlob,MAX_MEDIA_BYTES} from './attachment-media.ts';
const fixture=(text,name='clip.wav',mime='application/octet-stream')=>{const bytes=Buffer.from(text,'latin1');return [{name,mime,data:bytes.toString('base64')},{id:'a',name,mime,size:bytes.length}]};
test('legacy octet media requires supported byte signature',()=>{
 for(const [header,name,kind,type] of [['RIFF0000WAVEdata','clip.wav','audio','audio/wav'],['ID3abc','clip.mp3','audio','audio/mpeg'],['OggS'+'0'.repeat(24),'clip.ogg','audio','audio/ogg'],['fLaC0000','clip.flac','audio','audio/flac'],['0000ftypisom','clip.mp4','video','video/mp4'],['\x1a\x45\xdf\xa3xxxx','clip.webm','video','video/webm']]){const [file,metadata]=fixture(header,name);assert.equal(verifiedMediaBlob(file,metadata,kind).type,type)}
});
test('reject active text, playlists, remote URLs and wrong headers',()=>{for(const text of ['<html>evil</html>','<svg/>','#EXTM3U\nhttps://example.com','https://example.com/a.mp3','not media']){const [file,metadata]=fixture(text);assert.throws(()=>verifiedMediaBlob(file,metadata,'audio'))}});
test('reject mismatched name, size, MIME and oversized metadata',()=>{const [file,metadata]=fixture('RIFF0000WAVEdata');for(const patch of [{name:'other.wav'},{size:1},{size:MAX_MEDIA_BYTES+1},{mime:'audio/mpeg'}])assert.throws(()=>verifiedMediaBlob(file,{...metadata,...patch},'audio'));assert.throws(()=>verifiedMediaBlob({...file,mime:'text/html'},metadata,'audio'))});
