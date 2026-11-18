# Модель и уровень размышления бота

Серверное хранение выбора модели/уровня для modern-бота. Значения применяет внешний Hermes-плагин: backend валидирует и хранит идентификатор, но не знает каталога моделей, провайдера, URL и ключей.

## Хранение

`db.bots[i].settings = {model, reasoning, revision}`. Поле аддитивное: у старых ботов его нет, отсутствующее или пустое значение означает дефолт провайдера (`""`). Ревизия независима от `settings_revision` профиля/беседы и от `tool_policy`. Секретов провайдера здесь нет; сырой объект `settings` не публикуется — клиентам отдаётся только безопасная проекция, а неизвестные ключи, которые добавит будущая версия, в DTO не попадают.

## Операции

`bot_update_settings {bot, model?, reasoning?, revision?}` — только действующий human owner самого бота через cookie `mines_session`. Bot Bearer, тело-токен и `requester_id`/`owner` в теле не авторизуют (401/403). Чужой, legacy или отключённый бот → `BOT_SETTINGS_FORBIDDEN` (403). Ответ (и ответ `bot_get_model_settings {bot}`):

```json
{"bot":"<id>","model":"","reasoning":"","revision":0,"modelDefault":true,"reasoningDefault":true}
```

- `model` — 0–120 символов из `[A-Za-z0-9-_.:/@+]`; пробелы, управляющие, кавычки, `\` и не-ASCII отклоняются. `""` — дефолт плагина. Список моделей backend не хардкодит: допустимые значения для UI отдаёт плагин.
- `reasoning` — только `""`, `low`, `medium`, `high`; `""` — дефолт.
- `revision` — необязательный CAS; несовпадение (в том числе строка/null вместо числа) → `BOT_SETTINGS_CONFLICT` (400). Без поля запись безусловна.
- Неизвестный ключ (`provider`, `owner`, `commands`, `trust`, …), не-строка, `null`, пустой патч → `BOT_SETTINGS_INVALID` (400); отклонённый патч не меняет ничего, включая частично валидные поля.
- Владелец, username, права, trust-список, команды, установки и `settings_revision` не меняются. Ошибка записи на диск откатывает значение и ревизию.

`state.bots[].modelSettings` (и `bot_get_me.data.bot.modelSettings` у самого бота) — та же проекция `{model,reasoning,revision,modelDefault,reasoningDefault}`; сырой `settings` и `token_hash` не отдаются.

## Команда владельца из чата (`/model`)

`bot_owner_update_settings {update_id, model?, reasoning?, revision?}` — тот же выбор, но бот-токеном: `Authorization: Bearer <bot-token>`; cookie-сессия без Bearer → `AUTH_REQUIRED` (401). Тело не содержит `bot` — бот определяется токеном, поэтому чужого бота указать нельзя.

Сервер проверяет, что `update_id` (обязательный, число) принадлежит этому боту, ещё не подтверждён (`done != true`) и не использован для этой операции, а его `sender.id` — владелец бота; источник должен оставаться живым (та же authority, что у остальных owner-scoped операций бота). Только после этого применяются те же поля, валидация, ревизия и атомарность, что у `bot_update_settings` (`bot_model_settings_action`), и возвращается тот же DTO `{bot,model,reasoning,revision,modelDefault,reasoningDefault}`.

- Один owner-update пишет настройки один раз: после успешного применения внутренний маркер сохраняется вместе с настройками, повторный вызов (до ack и после) → `BOT_SETTINGS_CONFLICT` (400). После рестарта отказ сохраняется; в `bot_get_updates` маркер не отдаётся.
- Не-владелец (`sender` — обычный участник) → `BOT_SETTINGS_FORBIDDEN` (403); чужой/неизвестный `update_id` (включая id чужого бота) → `BOT_SETTINGS_FORBIDDEN` (403); ack’нутый или уже использованный update → `BOT_SETTINGS_CONFLICT` (400).
- Нет `update_id`, не-число, неизвестный ключ (`bot`, `owner`, `commands`, `provider`, …), невалидные `model`/`reasoning`/`revision` → `BOT_SETTINGS_INVALID`/`BOT_SETTINGS_CONFLICT` (400) без частичных изменений; отклонённый патч не расходует update — его можно повторить.
- Владелец, username, права, trust-список, команды, установки и `settings_revision` не меняются.

## Что должен сделать плагин

- Читать `bot_get_me.data.bot.modelSettings` (или `state`) при старте и после каждого `bot_get_updates`, чтобы подхватить изменение без перезапуска.
- Перед вызовом модели: `model != ""` → использовать как идентификатор модели; `""` → текущий дефолт Hermes. `reasoning` — так же: `""` → дефолт провайдера, иначе передать уровень в запрос.
- Отдавать UI список допустимых моделей/уровней; backend принимает произвольный безопасный идентификатор.
- На команду `/model …` от владельца вызывать `bot_owner_update_settings` с `update_id` полученного события; разрешать операцию в broker-whitelist (`update_id`,`model`,`reasoning`,`revision`). `BOT_SETTINGS_CONFLICT` на повторе означает «уже применено» — не считать это ошибкой; ответить владельцу текущими значениями из DTO. На `BOT_SETTINGS_FORBIDDEN`/`BOT_SETTINGS_INVALID` — сообщить отказ и не менять модель.
- Писать напрямую (без owner-update) bot-токеном нельзя: отдельной операции с произвольным `bot` нет, а human-путь по-прежнему только cookie владельца.

## Проверки

Четыре серверных теста (`src/backend/bot_model_settings_tests.rs`): owner-cookie-only через реальный HTTP (401 для bot Bearer и тело-токена, 403 для обычного участника и чужого/неизвестного бота, `no-store`), строгая валидация с атомарностью на 21 некорректном патче, неизменность владельца/прав/trust/команд/установок, дефолты для старых ботов без поля, проекция в `state` без `settings`/`token_hash`/секретов, сохранение после переоткрытия базы, CAS и откат при ошибке записи.

Четыре теста bot-токен-пути (`src/backend/bot_owner_settings_tests.rs`): owner→200 с тем же DTO, обычный участник→403, чужой бот/неизвестный update→403, отсутствие/не-число `update_id`→400, повторное использование и ack→400 без изменений, 22 некорректных патча атомарны и не расходуют update, сохранение маркера и настроек после переоткрытия базы, HTTP-статусы 200/400/403/401 и `no-store`. Полный прогон `cargo test --no-default-features --bin mines-server`: 100 passed, 0 failed.
