// Чистые правила быстрых настроек голоса: подписи, список устройств и громкость.
export type QuickSettingsKind = 'input' | 'output';
export type QuickDevice = {kind: string; deviceId: string; label: string};
export type DeviceOption = {value: string; label: string};

export type QuickLabels = {
 device: string;
 volume: string;
 aria: string;
 title: string;
 fallback: string;
 reset: string;
};

export function quickLabels(kind: QuickSettingsKind): QuickLabels {
 const input = kind === 'input';
 return {
  device: input ? 'Устройство ввода' : 'Устройство вывода',
  volume: input ? 'Громкость микрофона' : 'Громкость звука',
  aria: input ? 'Быстрые настройки микрофона' : 'Быстрые настройки наушников',
  title: input ? 'Настройки микрофона' : 'Настройки наушников',
  fallback: input ? 'Микрофон' : 'Динамики',
  reset: input ? 'Использовать по умолчанию · микрофон' : 'Использовать по умолчанию · динамики'
 };
}

export function quickDeviceKind(kind: QuickSettingsKind): 'audioinput' | 'audiooutput' {
 return kind === 'input' ? 'audioinput' : 'audiooutput';
}

export function quickPreferenceKey(kind: QuickSettingsKind): 'mic' | 'speaker' {
 return kind === 'input' ? 'mic' : 'speaker';
}

export function quickVolumeMax(kind: QuickSettingsKind): number {
 return kind === 'input' ? 200 : 100;
}

/** Громкость микрофона и звука живут в разных местах модели голоса. */
export function quickVolume(
 kind: QuickSettingsKind,
 voice: {micVolume: number; preferences: {volume: number}}
): number {
 return kind === 'input' ? voice.micVolume : voice.preferences.volume;
}

/**
 * Пункт «По умолчанию» всегда первый. Сохранённый выбор не исчезает, даже если устройство
 * отключили: он показывается последним с честной подписью.
 */
export function deviceOptions({
 devices,
 kind,
 selected,
 missing
}: {
 devices: readonly QuickDevice[];
 kind: QuickSettingsKind;
 selected: string;
 missing: boolean;
}): DeviceOption[] {
 const labels = quickLabels(kind);
 const options: DeviceOption[] = [
  {value: '', label: 'По умолчанию'},
  ...devices
   .filter(device => device.deviceId && device.deviceId !== 'default')
   .map((device, index) => ({
    value: device.deviceId,
    label: device.label || `${labels.fallback} ${index + 1}`
   }))
 ];
 if (selected && !options.some(option => option.value === selected))
  options.push({
   value: selected,
   label: missing
    ? 'Выбранное устройство (недоступно)'
    : selected === 'default'
      ? 'По умолчанию'
      : selected === 'communications'
        ? 'Устройство связи по умолчанию'
        : 'Выбранное устройство'
  });
 return options;
}
