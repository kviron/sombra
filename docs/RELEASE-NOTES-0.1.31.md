# Sombra 0.1.31 — 22 ноября 2026

Архитектура данных: всё приложение ходит в сеть через сервисы.

## Единый вход к данным

- `shared/api/api.ts` — один объект `api` с методами по всем операциям, сгруппированными по
  владельцу данных: `api.message.send`, `api.group.create`, `api.voice.poll`,
  `api.profileEffect.apply`. Транспорт (`request`) остался внутренним и вызывается только
  объектом `api` и сервисами.
- Сервисы — обычные объекты с методами: `entities/{message,user,conversation,group,sticker}/model/services`,
  `features/{voice-room,bots,account-settings}/model/services`,
  `shared/api/services/{state,file,session,attachment-cache}`.
- Вход и выход: `authService` (`login`, `register`, `logout`), состояние сеанса —
  `sessionService` (`token`, `clear`). Страницы входа и регистрации больше не знают про
  транспорт, проверки «сеанс не сменился» в компонентах тоже.
- Кэш вложений на экране настроек идёт через `attachmentCacheService`.

## Константы

`shared/const`: ключи хранилища (`mines-session`, `mines-jwt`, `mines-theme`, `mines-media`,
`sombra-participant-volume:`, `sombra-profile-note:`), hash-маршруты и значения темы. Строки
больше не разбросаны по компонентам.

## Проверки

`tsc`, `npm run lint` (0 ошибок), `check:fsd`, 92 теста, сборка. По правилу «UI только через
сервисы» проверено скриптом: файлов с функциональными импортами из транспорта вне `shared/api`
не осталось — только типы.
