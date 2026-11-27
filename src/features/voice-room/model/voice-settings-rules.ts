// Чистые правила панели «Голос и видео»: список устройств и условия кнопок.
// Сети и DOM здесь нет, поэтому правила проверяются тестами.
import type {MediaPreferences, NoiseSuppression} from './voice-input';

/** Поля устройств в порядке панели: микрофон и динамики в аудиоблоке, камера — в своём. */
export const deviceKinds = ['audioinput', 'audiooutput', 'videoinput'] as const;
export const devicePreferenceKeys = ['mic', 'speaker', 'camera'] as const;
export const deviceLabels = ['Устройство ввода · микрофон', 'Устройство вывода · динамики', 'Камера'] as const;
export const deviceResetLabels = ['микрофон', 'динамики', 'камера'] as const;

export type DevicePreferenceKey = (typeof devicePreferenceKeys)[number];
export type DeviceOption = {value: string; label: string};

export const noiseOptions: {value: NoiseSuppression; label: string}[] = [
 {value: 'enhanced', label: 'Усиленное (RNNoise)'},
 {value: 'standard', label: 'Стандартное'},
 {value: 'off', label: 'Выключено'}
];

/** Подпись сохранённого устройства, которого сейчас нет в системе или которое скрыто до разрешения. */
export function selectedDeviceLabel(selected: string, missing: boolean) {
 if (missing) return 'Выбранное устройство (недоступно)';
 if (selected === 'default') return 'По умолчанию';
 if (selected === 'communications') return 'Устройство связи по умолчанию';
 return 'Выбранное устройство';
}

/**
 * Список выбора: «по умолчанию», найденные устройства и сохранённый выбор.
 * Сохранённый выбор не подменяется молча, даже если устройство пропало.
 */
export function deviceOptions(
 devices: MediaDeviceInfo[],
 kind: MediaDeviceKind,
 selected: string,
 missing: boolean
): DeviceOption[] {
 const options: DeviceOption[] = [{value: '', label: 'По умолчанию'}];
 devices
  .filter(device => device.kind === kind && device.deviceId)
  .forEach((device, index) => options.push({value: device.deviceId, label: device.label || `Устройство ${index + 1}`}));
 if (selected && !options.some(option => option.value === selected))
  options.push({value: selected, label: selectedDeviceLabel(selected, missing)});
 return options;
}

/** Проверка устройства недоступна в звонке: она отнимает микрофон у разговора. */
export function testDisabled({busy, room}: {busy: boolean; room: string}) {
 return busy || !!room;
}

/** Пока список устройств обновляется или идёт звонок, выбор устройства заблокирован. */
export function deviceSelectDisabled({busy, requesting}: {busy: boolean; requesting: boolean}) {
 return busy || requesting;
}

/** Смена устройства или обработки звука обрывает проверку: поток нужно взять заново. */
export function preferenceStopsPreview(key: keyof MediaPreferences) {
 return key !== 'volume' && key !== 'relay';
}

/** Выбор шумоподавления приходит строкой из списка; чужое значение не применяем. */
export function noiseOption(value: string): NoiseSuppression | undefined {
 return noiseOptions.find(option => option.value === value)?.value;
}
