// Правила ссылок на сообщения: превью, поиск назначения и подсказка пустого списка.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
 emptyDestinationsText,
 filterDestinations,
 matchesDestination,
 messagePreview
} from './message-references-rules.ts';

const message = {id: 'm1', channel: 'c1', user: 'u1', text: '', time: 1};

const destinations = [
 {id: 'd1', name: 'Аня', keywords: 'друг'},
 {id: 'd2', name: 'Команда', group: {id: 'g1', name: 'Рабочая'}},
 {id: 'd3', name: 'Голос', voice: true}
];

test('превью сообщения показывает текст, вложение или тип содержимого', () => {
 assert.equal(messagePreview({...message, text: '  Привет  '}), 'Привет');
 assert.equal(
  messagePreview({...message, attachment: {id: 'a1', name: 'план.pdf', size: 1, mime: 'application/pdf'}}),
  'план.pdf'
 );
 assert.equal(messagePreview({...message, sticker: 's1'}), 'Стикер');
 assert.equal(messagePreview({...message, gif: 'g1'}), 'GIF');
 assert.equal(messagePreview(message), 'Сообщение');
});

test('поиск назначения идёт по имени, группе и ключевым словам', () => {
 assert.equal(matchesDestination(destinations[0], 'аня'), true);
 assert.equal(matchesDestination(destinations[0], 'друг'), true);
 assert.equal(matchesDestination(destinations[1], 'рабоч'), true);
 assert.equal(matchesDestination(destinations[1], 'аня'), false);
 assert.equal(matchesDestination(destinations[2], '  '), true, 'пустой запрос пропускает всё');
});

test('фильтр назначений сохраняет порядок и допускает пустой запрос', () => {
 assert.deepEqual(
  filterDestinations(destinations, '').map(item => item.id),
  ['d1', 'd2', 'd3']
 );
 assert.deepEqual(
  filterDestinations(destinations, 'ком').map(item => item.id),
  ['d2']
 );
 assert.deepEqual(filterDestinations(destinations, 'нет-такого'), []);
});

test('подсказка различает пустой поиск и отсутствие назначений', () => {
 assert.equal(emptyDestinationsText(''), 'Нет доступных чатов и каналов.');
 assert.equal(emptyDestinationsText('  '), 'Нет доступных чатов и каналов.');
 assert.equal(emptyDestinationsText('аня'), 'Чаты и каналы не найдены.');
});
