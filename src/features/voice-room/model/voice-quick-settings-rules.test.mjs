// Правила быстрых настроек голоса: подписи, список устройств и громкость.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
 deviceOptions,
 matchingDevices,
 quickDeviceKind,
 quickLabels,
 quickPreferenceKey,
 quickVolume,
 quickVolumeMax
} from './voice-quick-settings-rules.ts';

const devices = [
 {kind: 'audioinput', deviceId: 'mic-1', label: 'Настольный микрофон'},
 {kind: 'audioinput', deviceId: 'mic-2', label: ''},
 {kind: 'audioinput', deviceId: 'default', label: 'По умолчанию'},
 {kind: 'audioinput', deviceId: '', label: 'Без идентификатора'},
 {kind: 'audiooutput', deviceId: 'spk-1', label: 'Наушники'}
];

test('у микрофона и наушников свои подписи, ключи и пределы громкости', () => {
 const input = quickLabels('input');
 const output = quickLabels('output');
 assert.equal(input.device, 'Устройство ввода');
 assert.equal(input.volume, 'Громкость микрофона');
 assert.equal(input.reset, 'Использовать по умолчанию · микрофон');
 assert.equal(output.device, 'Устройство вывода');
 assert.equal(output.volume, 'Громкость звука');
 assert.equal(output.aria, 'Быстрые настройки наушников');
 assert.equal(quickPreferenceKey('input'), 'mic');
 assert.equal(quickPreferenceKey('output'), 'speaker');
 assert.equal(quickVolumeMax('input'), 200);
 assert.equal(quickVolumeMax('output'), 100);
});

test('список устройств фильтруется по виду и пропускает «default» без идентификатора', () => {
 assert.deepEqual(
  matchingDevices(devices, 'input').map(device => device.deviceId),
  ['mic-1', 'mic-2']
 );
 assert.deepEqual(
  matchingDevices(devices, 'output').map(device => device.deviceId),
  ['spk-1']
 );
 assert.equal(quickDeviceKind('input'), 'audioinput');
 assert.equal(quickDeviceKind('output'), 'audiooutput');
});

test('безымянное устройство получает номер, «По умолчанию» всегда первый', () => {
 assert.deepEqual(deviceOptions({devices, kind: 'input', selected: '', missing: false}), [
  {value: '', label: 'По умолчанию'},
  {value: 'mic-1', label: 'Настольный микрофон'},
  {value: 'mic-2', label: 'Микрофон 2'}
 ]);
});

test('сохранённый выбор не исчезает из списка, даже если устройство недоступно', () => {
 const missing = deviceOptions({devices, kind: 'input', selected: 'mic-gone', missing: true});
 assert.deepEqual(missing.at(-1), {value: 'mic-gone', label: 'Выбранное устройство (недоступно)'});
 const communication = deviceOptions({devices, kind: 'output', selected: 'communications', missing: false});
 assert.deepEqual(communication.at(-1), {value: 'communications', label: 'Устройство связи по умолчанию'});
 const fallback = deviceOptions({devices, kind: 'output', selected: 'default', missing: false});
 assert.deepEqual(fallback.at(-1), {value: 'default', label: 'По умолчанию'});
});

test('громкость берётся из своего источника', () => {
 const voice = {micVolume: 130, preferences: {volume: 80}};
 assert.equal(quickVolume('input', voice), 130);
 assert.equal(quickVolume('output', voice), 80);
});
