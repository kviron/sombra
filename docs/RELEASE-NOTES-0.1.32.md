# Sombra 0.1.32 — 22 ноября 2026

Типы отдельно, транспорт отдельно.

## `shared/types`

Транспортные типы больше не лежат в одном файле с вызовами. Разложены по темам и
импортируются из `@/shared/types`:

| Файл | Что внутри |
|---|---|
| `user.ts` | `User`, `SessionDto` |
| `chat.ts` | `ChatState`, `ChatMessage`, `Dialog`, `Sticker`, `Friend`, `ChatPreferences`, вложения |
| `group.ts` | `Group`, `Channel`, `GroupRole`, `GroupPermission` |
| `profile.ts` | обложка, украшения, эффекты профиля |
| `bot.ts` | `Bot`, `BotCommand`, `BotModelSettings`, `BotReasoning` |
| `voice.ts` | `VoicePresence` |

58 файлов переведены на новый импорт. Это чистое перекладывание: ни одно объявление не
изменилось, поэтому поведение прежнее.

## `backend.ts` → `transport.ts`

Файл назывался «backend», хотя внутри был транспорт. Теперь `shared/api/transport.ts` —
транспорт, сеанс, вход и выход. Его вызывают только объект `api` и сервисы; в остальном коде
остались исключительно импорты типов из `shared/types`.

## Документация

- `docs/FRONTEND-STRUCTURE.md`: карта `shared` (`api`, `const`, `types`, `lib`, `ui`), правило
  «данные только через сервисы» шестым пунктом, обновлённая таблица «куда класть код».
- `AGENTS.md`: то же правило для новых правок.

## Проверки

`tsc`, `npm run lint` (0 ошибок), `check:fsd`, 92 теста, сборка.
