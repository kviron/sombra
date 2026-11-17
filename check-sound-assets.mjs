import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

for(const [file,seconds] of [['voice-peer-joined.wav',0.8],['voice-left.wav',0.8],['call-ringtone.wav',4]]){
 test(`SoundCraft asset ${file} has safe non-silent PCM`,()=>{
  const buffer=readFileSync(new URL(`./ui/app/${file}`,import.meta.url));
  assert.equal(buffer.toString('ascii',0,4),'RIFF');
  assert.equal(buffer.toString('ascii',8,12),'WAVE');
  let format,data;
  for(let offset=12;offset+8<=buffer.length;){
   const id=buffer.toString('ascii',offset,offset+4),size=buffer.readUInt32LE(offset+4);
   if(id==='fmt ')format=buffer.subarray(offset+8,offset+8+size);
   if(id==='data')data=buffer.subarray(offset+8,offset+8+size);
   offset+=8+size+(size%2);
  }
  assert.ok(format&&data);
  assert.equal(format.readUInt16LE(0),1);
  const channels=format.readUInt16LE(2),rate=format.readUInt32LE(4),bits=format.readUInt16LE(14);
  assert.equal(channels,2);assert.equal(rate,48000);assert.equal(bits,16);
  assert.ok(Math.abs(data.length/(rate*channels*2)-seconds)<0.01);
  let peak=0,energy=0;
  for(let index=0;index<data.length;index+=2){const value=data.readInt16LE(index)/32768;peak=Math.max(peak,Math.abs(value));energy+=value*value;}
  assert.ok(peak>0.05&&peak<0.32,`peak=${peak}`);
  assert.ok(Math.sqrt(energy/(data.length/2))>0.005,'not silent');
  const tail=data.subarray(-480*channels*2);
  assert.ok([...Array(tail.length/2)].every((_,index)=>Math.abs(tail.readInt16LE(index*2))<64),'quiet loop boundary');
 });
}
