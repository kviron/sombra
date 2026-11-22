# Обновления Sombra

Клиент — официальный [Tauri v2 updater](https://v2.tauri.app/plugin/updater/). Установщик — NSIS currentUser, установка passive, подпись проверяется до установки, понижение версии запрещено.

## Канал обновлений: GitHub Releases

Манифест и установщик живут целиком в GitHub Releases, как в [openidea](https://github.com/l0ng-ai/openidea):

```
https://github.com/kviron/sombra/releases/latest/download/latest.json
```

`latest.json` — обычный релизный артефакт: его собирает `updater-manifest` в `.github/workflows/release.yml`. Ссылки в нём указывают на `releases/download/<тег>/Sombra_<версия>_x64-setup.exe`, подпись — на сам установщик, поэтому подменить файл нельзя.

`src-tauri/tauri.conf.json` держит два адреса: сначала GitHub, затем старый `sombra.mi-nerva.ru/updates/latest.json` как резерв. VPS больше не обязателен для обновлений.

**Важно:** репозиторий должен быть публичным. Закрытый репозиторий отдаёт 404 без токена, и updater не сможет скачать манифест — токены в клиент встраивать нельзя.

## Один раз настроить

1. Репозиторий `kviron/sombra` → Settings → General → Danger Zone → **Change visibility → Public**.
2. Settings → Secrets and variables → Actions → New repository secret:
   - `TAURI_SIGNING_PRIVATE_KEY` — содержимое `release-secrets/sombra.key`;
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — пароль ключа (сейчас пустой, тогда секрет не нужен).
3. Проверить, что Actions разрешены (Settings → Actions → General).

Ключ подписи не меняется от выпуска к выпуску. Потеря ключа = невозможность обновить уже установленные клиенты.

## Выпуск

```bash
# 1. Версия — в четырёх местах
#    Cargo.toml ([workspace.package]), src-tauri/tauri.conf.json,
#    package.json, package-lock.json (name/version)
npm run check:release          # версии, канал, публичный ключ, секреты в индексе

# 2. Коммит и тег
git add -A && git commit -m "Release Sombra 0.1.26"
git tag v0.1.26 && git push origin main --tags
```

Тег `vX.Y.Z` запускает `.github/workflows/release.yml`:

| Шаг | Что делает |
|---|---|
| `config` | проверяет, что тег совпадает с версией и что ключ подписи задан |
| `create-release` | черновик релиза с автоматическими заметками |
| `build` | `tauri-action` собирает Windows x64 NSIS и подписывает, загружает `.exe` и `.sig` в черновик |
| `updater-manifest` | собирает `latest.json` из `.sig`, падает, если подписи нет; публикует `windows-x86_64` и `windows-x86_64-nsis` |
| `publish` | снимает черновик — только теперь `releases/latest` отдаёт новый манифест |

Проверка после выпуска:

```bash
curl -s https://github.com/kviron/sombra/releases/latest/download/latest.json | head -40
```

## Мост для старых клиентов (≤ 0.1.25)

Уже установленные версии читают только VPS-манифест. После выпуска новой версии один раз обновить его на сервере:

```bash
ssh root@sombra.mi-nerva.ru 'sh -s v0.1.26' < deploy/bridge-latest.sh
```

Скрипт кладёт в `/var/www/sombra-updates/latest.json` манифест из GitHub (URL уже указывает на GitHub, подпись та же). После 0.1.26 мост можно убрать из `endpoints`, когда на новой версии останется единственный пользователь.

## Локальный выпуск (аварийный)

```bash
TAURI_SIGNING_PRIVATE_KEY="$(cat release-secrets/sombra.key)" npm run release:windows
gh release upload v0.1.26 target/release/bundle/nsis/*.exe target/release/bundle/nsis/*.exe.sig
```

Скрипт проверяет конфигурацию, собирает через `src-tauri/tauri.release.json` (NSIS, `createUpdaterArtifacts`) и печатает команду загрузки. `latest.json` в этом случае собирают вручную — `node release-manifest.mjs`, затем загружают как asset.

## Откат

Ошибочный выпуск: удалить релиз (или снять `latest`) и опубликовать исправление с большей версией. Автоматического понижения нет: клиент с 0.1.27 не откатится на 0.1.26. Для старых клиентов VPS-манифест возвращается из бэкапа `/root/sombra-backups/release-*-manifest-*`.

## Код клиента

- `src-tauri/src/updates.rs` — команды `check_update`, `download_update`, `install_update`, `restart_app`; проверка раз в 4 часа, тайм-ауты 15 с на проверку и 10 мин на загрузку.
- `src/features/updates/model/update-controller.ts` — фазы `checking → available → downloading → ready → installing`; скачивание и установка — только по явному действию пользователя.
- `npm run test:updater` — тесты состояний.
