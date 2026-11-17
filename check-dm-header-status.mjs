import test from 'node:test';import assert from 'node:assert/strict';
import {peerStatus,lastActivity} from './ui/app/dm-header-status.ts';
const now=Date.parse('2026-11-17T12:00:00Z');
const ago=seconds=>lastActivity(now/1000-seconds,now);
test('typing replaces online and expires without another server event',()=>{
 assert.equal(peerStatus({online:true},now/1000+6,now),'печатает…');
 assert.equal(peerStatus({online:true},now/1000+6,now+6000),'В сети');
 assert.equal(peerStatus({online:true},NaN,now),'В сети');
});
test('offline unknown/invalid/future timestamps are not invented',()=>{
 for(const last_seen of [undefined,0,NaN,Infinity,now/1000+900])assert.equal(peerStatus({online:false,last_seen},0,now),'Не в сети');
 assert.equal(ago(10),'Был недавно');assert.equal(ago(59),'Был недавно');
 assert.equal(ago(60),'Был минуту назад');assert.equal(ago(180),'Был 3 минуты назад');
});
test('bots retain their real identity instead of human online claims',()=>{
 assert.equal(peerStatus({online:true,bot:true},0,now),'Бот');
 assert.equal(peerStatus({bot:true},now/1000+2,now),'печатает…');
});
test('relative minutes and hours have Russian 1/2-4/5-20/21 endings',()=>{
 for(const [n,text] of [[2,'2 минуты'],[5,'5 минут'],[11,'11 минут'],[14,'14 минут'],[21,'21 минуту'],[24,'24 минуты']])assert.equal(ago(n*60),`Был ${text} назад`);
 for(const [n,text] of [[1,'час'],[2,'2 часа'],[5,'5 часов'],[11,'11 часов'],[21,'21 час'],[22,'22 часа']])assert.equal(ago(n*3600),`Был ${text} назад`);
});
test('days, months and years switch at unit boundaries with correct endings',()=>{
 for(const [n,text] of [[1,'день'],[2,'2 дня'],[5,'5 дней'],[11,'11 дней'],[21,'21 день'],[24,'24 дня']])assert.equal(ago(n*86400),`Был ${text} назад`);
 for(const [n,text] of [[1,'месяц'],[2,'2 месяца'],[5,'5 месяцев'],[11,'11 месяцев']])assert.equal(ago(n*30*86400),`Заходил ${text} назад`);
 for(const [n,text] of [[1,'год'],[2,'2 года'],[5,'5 лет'],[11,'11 лет'],[21,'21 год']])assert.equal(ago(n*365*86400),`Заходил ${text} назад`);
});
test('same timestamp updates as clock advances',()=>{
 const seen=now/1000-59;assert.equal(lastActivity(seen,now),'Был недавно');
 assert.equal(lastActivity(seen,now+1000),'Был минуту назад');
 assert.equal(lastActivity(seen,now+3541000),'Был час назад');
});
