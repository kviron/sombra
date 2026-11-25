// Правила панели помощника: подсказки, вставка упоминаний и музыкальные команды.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
 filterSuggestions,
 insertedMention,
 localCommand,
 musicCommands,
 musicCommandsFor,
 musicEnterPressed,
 roomMusicEnabled,
 subscribeComposerText,
 withoutLeadingSpace
} from './assistant-composer-rules.ts';

test('уведомление о статусе отправки не возвращает очищенный черновик', () => {
 let text = 'отправленное сообщение';
 const listeners = new Set();
 const composer = {
  getState: () => ({text}),
  subscribe(listener) {
   listeners.add(listener);
   return () => listeners.delete(listener);
  }
 };
 const notify = () => listeners.forEach(listener => listener());
 const changes = [];
 const unsubscribe = subscribeComposerText(composer, value => changes.push(value));

 // Адаптер снимает доступность Send до того, как React синхронизирует очищенный черновик.
 notify();
 assert.deepEqual(changes, []);
 text = '';
 notify();
 notify();
 text = 'следующее сообщение';
 notify();
 assert.deepEqual(changes, ['', 'следующее сообщение']);
 unsubscribe();
 text = 'после закрытия чата';
 notify();
 assert.equal(changes.length, 2);
});

const suggestion = (id, search, label = id) => ({
 id,
 type: 'command',
 label,
 description: label,
 metadata: {insert: label, avatar: '', search}
});

const enter = {
 roomMusic: true,
 enabled: true,
 key: 'Enter',
 shift: false,
 ctrl: false,
 alt: false,
 meta: false,
 composing: false,
 keyCode: 13
};

test('музыка доступна только в голосовом канале указанной группы', () => {
 const groups = [
  {
   id: 'g1',
   channels: [
    {id: 'voice', kind: 'voice'},
    {id: 'text', kind: 'text'}
   ]
  },
  {id: 'g2', channels: [{id: 'voice', kind: 'voice'}]}
 ];
 assert.equal(roomMusicEnabled(groups, 'g1', 'voice'), true);
 assert.equal(roomMusicEnabled(groups, 'g1', 'text'), false);
 assert.equal(roomMusicEnabled(groups, 'g2', 'voice'), true);
 assert.equal(roomMusicEnabled(groups, undefined, 'voice'), false);
 assert.equal(roomMusicEnabled(groups, 'g1', 'чужой'), false);
});

test('команды музыки появляются только в комнате', () => {
 assert.equal(musicCommandsFor(false).length, 0);
 assert.deepEqual(
  musicCommandsFor(true).map(item => item.label),
  musicCommands.map(item => item.label)
 );
 assert.equal(musicCommands[0].label, '/play');
 assert.equal(musicCommands[0].metadata.insert, '/play');
 assert.equal(musicCommands[0].metadata.search, 'play');
});

test('подсказки ищутся по началу слова и не показываются при запрете', () => {
 const items = [suggestion('a', 'Аня anya'), suggestion('b', 'Борис'), suggestion('c', 'Аня вторая')];
 assert.deepEqual(
  filterSuggestions(items, 'ан', true).map(item => item.id),
  ['a', 'c']
 );
 assert.deepEqual(
  filterSuggestions(items, 'anya', true).map(item => item.id),
  ['a']
 );
 assert.deepEqual(filterSuggestions(items, 'ан', false), []);
 assert.deepEqual(
  filterSuggestions(
   Array.from({length: 20}, (_, index) => suggestion(String(index), 'слово')),
   'сл',
   true
  ).length,
  12
 );
});

test('Enter отправляет музыку без модификаторов и не во время ввода', () => {
 assert.equal(musicEnterPressed(enter), true);
 assert.equal(musicEnterPressed({...enter, roomMusic: false}), false);
 assert.equal(musicEnterPressed({...enter, enabled: false}), false);
 assert.equal(musicEnterPressed({...enter, key: 'Enter', shift: true}), false);
 assert.equal(musicEnterPressed({...enter, ctrl: true}), false);
 assert.equal(musicEnterPressed({...enter, alt: true}), false);
 assert.equal(musicEnterPressed({...enter, meta: true}), false);
 assert.equal(musicEnterPressed({...enter, composing: true}), false);
 assert.equal(musicEnterPressed({...enter, keyCode: 229}), false);
 assert.equal(musicEnterPressed({...enter, key: 'a'}), false);
});

test('смещения упоминания проверяются по тексту', () => {
 assert.deepEqual(insertedMention(7, '@anya', 'Привет @anya, как дела'), {start: 7, end: 12});
 assert.equal(insertedMention(7, '@anya', 'Привет @Anyа, как дела'), undefined);
 assert.deepEqual(insertedMention(0, '@anya', '@anya'), {start: 0, end: 5});
});

test('локальные команды и пробел после вставки', () => {
 assert.equal(localCommand('local:clear'), 'clear');
 assert.equal(localCommand('local:search'), 'search');
 assert.equal(localCommand('music:play'), undefined);
 assert.equal(withoutLeadingSpace(' /search'), '/search');
 assert.equal(withoutLeadingSpace('/search'), '/search');
});
