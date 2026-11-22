// Правила панели «Голос и видео»: список устройств, уровень проверки и условия кнопок.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
 deviceOptions,
 deviceSelectDisabled,
 microphoneLevel,
 noiseOption,
 noiseOptions,
 preferenceStopsPreview,
 selectedDeviceLabel,
 testDisabled
} from './voice-settings-rules.ts';

const devices = [
 {kind: 'audioinput', deviceId: 'mic-1', label: 'Микрофон'},
 {kind: 'audioinput', deviceId: 'mic-2', label: ''},
 {kind: 'audiooutput', deviceId: 'spk-1', label: 'Динамики'},
 {kind: 'videoinput', deviceId: 'cam-1', label: 'Камера'}
];

test('список устройств начинается с «по умолчанию» и знает только свой тип', () => {
 const options = deviceOptions(devices, 'audioinput', '', false);
 assert.deepEqual(
  options.map(option => option.value),
  ['', 'mic-1', 'mic-2']
 );
 assert.equal(options[0].label, 'По умолчанию');
});

test('пустая подпись устройства заменяется номером', () => {
 const options = deviceOptions(devices, 'audioinput', '', false);
 assert.equal(options[2].label, 'Устройство 2');
});

test('сохранённое недоступное устройство остаётся в списке выбора', () => {
 const options = deviceOptions(devices, 'audioinput', 'mic-old', true);
 assert.deepEqual(options.at(-1), {value: 'mic-old', label: 'Выбранное устройство (недоступно)'});
 const known = deviceOptions(devices, 'audioinput', 'mic-1', false);
 assert.equal(known.filter(option => option.value === 'mic-1').length, 1, 'известное устройство не дублируется');
});

test('подпись сохранённого устройства различает служебные значения', () => {
 assert.equal(selectedDeviceLabel('same', true), 'Выбранное устройство (недоступно)');
 assert.equal(selectedDeviceLabel('default', false), 'По умолчанию');
 assert.equal(selectedDeviceLabel('communications', false), 'Устройство связи по умолчанию');
 assert.equal(selectedDeviceLabel('mic-1', false), 'Выбранное устройство');
});

test('уровень микрофона — пик отклонения, ограниченный сотней', () => {
 assert.equal(microphoneLevel(new Uint8Array([128, 128, 128])), 0, 'тишина');
 assert.equal(microphoneLevel(new Uint8Array([128 + 10])), 30);
 assert.equal(microphoneLevel(new Uint8Array([0])), 100, 'пик упирается в предел');
 assert.equal(microphoneLevel(new Uint8Array([])), 0, 'пустой буфер не ломает расчёт');
});

test('проверка устройства недоступна во время звонка или другой проверки', () => {
 assert.equal(testDisabled({busy: false, room: ''}), false);
 assert.equal(testDisabled({busy: false, room: 'room-1'}), true);
 assert.equal(testDisabled({busy: true, room: ''}), true);
});

test('выбор устройства недоступен во время звонка или обновления списка', () => {
 assert.equal(deviceSelectDisabled({busy: false, requesting: false}), false);
 assert.equal(deviceSelectDisabled({busy: true, requesting: false}), true);
 assert.equal(deviceSelectDisabled({busy: false, requesting: true}), true);
});

test('проверку обрывает смена устройства и обработки звука, но не громкость и релей', () => {
 for (const key of ['mic', 'speaker', 'camera', 'echo', 'noise']) assert.equal(preferenceStopsPreview(key), true, key);
 assert.equal(preferenceStopsPreview('volume'), false);
 assert.equal(preferenceStopsPreview('relay'), false);
});

test('чужое значение шумоподавления не применяется', () => {
 assert.equal(noiseOptions.length, 3);
 assert.equal(noiseOption('enhanced'), 'enhanced');
 assert.equal(noiseOption('off'), 'off');
 assert.equal(noiseOption('unknown'), undefined);
});
