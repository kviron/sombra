// Правила музыки комнаты: позиция, свежесть снапшота, команды, подписи и очередь.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
 addDisabled,
 commandFailureMessage,
 commandProblem,
 hasMoreQueue,
 isFreshSnapshot,
 receivedAt,
 playbackSource,
 trackPosition,
 trackStatusText,
 trackTime,
 visibleQueue
} from './room-music-rules.ts';

const track = {id: 't1', title: 'Трек', durationMs: 180000};
const snapshot = {
 room: 'room-1',
 revision: 1,
 serverTimeMs: 1000,
 positionMs: 5000,
 status: 'playing',
 track,
 queue: [track, {...track, id: 't2', durationMs: 60000}]
};

test('позиция растёт только у играющего трека и не выходит за длительность', () => {
 assert.equal(trackPosition({state: snapshot, received: 100}, 1100), 6000);
 assert.equal(trackPosition({state: {...snapshot, status: 'paused'}, received: 100}, 1100), 5000);
 assert.equal(trackPosition({state: snapshot, received: 0}, 999_999), 180000, 'позиция ограничена длительностью');
 assert.equal(trackPosition({state: {...snapshot, track: null}, received: 0}, 1100), 0);
});

test('время получения — середина запроса', () => {
 assert.equal(receivedAt(1000, 1400), 1200);
});

test('медленный ответ не откатывает уже показанный снапшот', () => {
 assert.equal(isFreshSnapshot(null, snapshot), true);
 assert.equal(isFreshSnapshot({state: {...snapshot, serverTimeMs: 2000}, received: 0}, snapshot), false);
 assert.equal(isFreshSnapshot({state: {...snapshot, serverTimeMs: 1000}, received: 0}, snapshot), true);
 assert.equal(isFreshSnapshot({state: {...snapshot, room: 'room-2'}, received: 0}, snapshot), true);
});

test('команда проверяет аргументы до запроса', () => {
 assert.equal(commandProblem({room: undefined, action: 'pause'}), 'Сначала войдите в голосовую комнату.');
 assert.equal(commandProblem({room: 'room-1', action: 'add'}), 'Укажите ссылку после /play.');
 assert.equal(
  commandProblem({room: 'room-1', action: 'pause', url: 'https://music.yandex.ru/x'}),
  'Эта команда не принимает ссылку.'
 );
 assert.equal(
  commandProblem({room: 'room-1', action: 'add', url: 'https://music.yandex.ru/x', limit: 0}),
  'Укажите число треков от 1 до 1000.'
 );
 assert.equal(commandProblem({room: 'room-1', action: 'add', url: 'https://music.yandex.ru/x', limit: 32}), undefined);
});

test('ошибки сервера музыки переводятся на русский', () => {
 assert.equal(
  commandFailureMessage(new Error('MUSIC_PROVIDER_NOT_CONFIGURED')),
  'Яндекс Музыка пока не подключена на сервере.'
 );
 assert.equal(
  commandFailureMessage(new Error('MUSIC_SOURCE_NOT_APPROVED')),
  'Эта ссылка не входит в разрешённый каталог комнаты.'
 );
 assert.equal(
  commandFailureMessage(new Error('offline')),
  'Не удалось выполнить команду музыки. Проверьте подключение к комнате.'
 );
});

test('время трека показывается минутами и секундами', () => {
 assert.equal(trackTime(0), '0:00');
 assert.equal(trackTime(65000), '1:05');
 assert.equal(trackTime(180000), '3:00');
});

test('для проигрывателя приватный файл комнаты важнее адреса трека', () => {
 const publicTrack = {...track, url: 'https://example.org/track.mp3'};
 assert.equal(
  playbackSource({room: 'room-1', assetId: undefined, trackId: 't1', track: publicTrack, privateAudio: undefined}),
  'https://example.org/track.mp3'
 );
 assert.equal(
  playbackSource({
   room: 'room-1',
   assetId: 'a1',
   trackId: 't1',
   track: {...track, assetId: 'a1'},
   privateAudio: {room: 'room-1', trackId: 't1', url: 'blob:track'}
  }),
  'blob:track'
 );
 assert.equal(
  playbackSource({
   room: 'room-1',
   assetId: 'a1',
   trackId: 't2',
   track: {...track, assetId: 'a1'},
   privateAudio: {room: 'room-1', trackId: 't1', url: 'blob:track'}
  }),
  undefined,
  'файл другого трека не подставляется'
 );
});

test('подпись состояния зависит от комнаты, сервера и трека', () => {
 assert.equal(
  trackStatusText({joined: false, unavailable: true, hasTrack: true, playing: true}),
  'Войдите в комнату, чтобы включить музыку'
 );
 assert.equal(
  trackStatusText({joined: true, unavailable: true, hasTrack: true, playing: true}),
  'Музыка недоступна на этом сервере'
 );
 assert.equal(
  trackStatusText({joined: true, unavailable: false, hasTrack: false, playing: false}),
  'Добавьте трек в общую очередь'
 );
 assert.equal(trackStatusText({joined: true, unavailable: false, hasTrack: true, playing: true}), 'Сейчас играет');
 assert.equal(trackStatusText({joined: true, unavailable: false, hasTrack: true, playing: false}), 'На паузе');
});

test('кнопка добавления и порции очереди', () => {
 assert.equal(addDisabled({joined: false, unavailable: false, pending: false, hasLink: true}), true);
 assert.equal(addDisabled({joined: true, unavailable: true, pending: false, hasLink: true}), true);
 assert.equal(addDisabled({joined: true, unavailable: false, pending: true, hasLink: true}), true);
 assert.equal(addDisabled({joined: true, unavailable: false, pending: false, hasLink: false}), true);
 assert.equal(addDisabled({joined: true, unavailable: false, pending: false, hasLink: true}), false);
 assert.deepEqual(visibleQueue(snapshot.queue, 1), [snapshot.queue[0]]);
 assert.equal(hasMoreQueue(snapshot.queue, 1), true);
 assert.equal(hasMoreQueue(snapshot.queue, 2), false);
});
