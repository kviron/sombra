import {serializeDecoration, normalizeDecoration} from '../normalize.ts';

const ramp = [
 '#000000',
 '#111111',
 '#222222',
 '#333333',
 '#444444',
 '#555555',
 '#666666',
 '#777777',
 '#888888',
 '#999999',
 '#aaaaaa',
 '#bbbbbb'
];
const worst = {
 v: 1,
 target: 'avatar',
 seed: 4294967295,
 layers: Array.from({length: 3}, (_, index) => ({
  effect: ['holy/divine-shield', 'critters/slime', 'holy/divine-shield'][index],
  palette: ramp,
  anchor: index === 0 ? 'ring' : 'bottom-right',
  scale: 1.5078125,
  intensity: 0.7421875,
  flip: true
 }))
};
const normalized = normalizeDecoration(worst);
console.log('ok', normalized.ok, 'layers', normalized.value?.layers.length);
const wire = serializeDecoration(normalized.value);
console.log('bytes', Buffer.byteLength(wire, 'utf8'), 'chars', wire.length);
const cover = serializeDecoration(
 normalizeDecoration({
  v: 1,
  target: 'cover',
  seed: 9,
  layers: [{effect: 'weather/aurora', palette: ramp, anchor: 'fill', scale: 2, intensity: 1}]
 }).value
);
console.log('cover bytes', Buffer.byteLength(cover, 'utf8'));
