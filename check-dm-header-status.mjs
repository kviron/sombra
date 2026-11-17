import test from 'node:test';import assert from 'node:assert/strict';
import {peerStatus} from './ui/app/dm-header-status.ts';
const now=Date.parse('2026-11-17T12:00:00Z');
test('typing replaces online and expires without another server event',()=>{
 assert.equal(peerStatus({online:true},now/1000+6,now),'печатает…');
 assert.equal(peerStatus({online:true},now/1000+6,now+6000),'В сети');
 assert.equal(peerStatus({online:true},NaN,now),'В сети');
});
test('offline unknown/invalid/future timestamps are not invented',()=>{
 for(const last_seen of [undefined,0,NaN,now/1000+900])assert.equal(peerStatus({online:false,last_seen},0,now),'Не в сети');
 assert.equal(peerStatus({online:false,last_seen:now/1000-10},0,now),'Был(а) только что');
 assert.match(peerStatus({online:false,last_seen:now/1000-180},0,now),/^Был\(а\) сегодня в /);
});
test('bots retain their real identity instead of human online claims',()=>{
 assert.equal(peerStatus({online:true,bot:true},0,now),'Бот');
 assert.equal(peerStatus({bot:true},now/1000+2,now),'печатает…');
});
