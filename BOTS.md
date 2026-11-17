# Боты Sombra (с версии 0.1.13)

## Для участников

**Hermes — отдельный пользователь `@hermes`**, установленный в группе «Игровая». В текстовом канале, а также чате голосового канала:

- `/ask@hermes вопрос` или `/ai@hermes вопрос` — запрос к ИИ;
- `@hermes вопрос` — обращение упоминанием;
- `/help@hermes`, `/start@hermes` — знакомство/справка;
- `/reset@hermes` — очистить ваш контекст этого чата.

Откройте профиль Hermes в списке участников → «Личное сообщение». В личке бот отвечает на обычный текст; `/help` и `/reset` работают без суффикса. Список команд появляется после `/` в поле сообщения. Вызовы и дружба с ботом не предлагаются; групповые личные диалоги с ботами пока не поддерживаются. Вложения пока не передаются модели: коннектор обрабатывает только текст.

В группе бот получает **только новые зарегистрированные команды и упоминания**, не всю переписку и не сообщения до установки. Личный чат инициирует человек. Текст без адресации не передаётся даже из чата голосового канала. Переписка других групп/личек и сообщения других ботов в события не попадают. Ответы на сообщения без команды/упоминания пока не являются отдельным триггером.

## Модель и управление

У бота стабильный user ID, `bot: true`, уникальный username, профиль, отметка БОТ и присутствие по heartbeat коннектора. Парольного входа и человеческих сессий у него нет. Токен бота не даёт доступ к человеческим API, друзьям, файлам или звонкам.

Владелец группы открывает значок бота в шапке, задаёт имя/username и создаёт подключение. Токен показывается один раз, скрытым полем; копируется только явной кнопкой. Сервер хранит SHA-256 токена, не исходный ключ. Владелец бота может заменить ключ; старый немедленно отзывается. Владелец группы может отключить установку. Максимум пять активных ботов на группу. Добавить существующего бота в другую свою группу можно через `add_bot_to_group`; полномочия владельцев проверяются сервером.

Команды этой первой версии: `start`, `help`, `ask`, `ai`, `reset`. Произвольный редактор/регистрация других команд, inline-кнопки, вебхуки и вложения в модели в этот выпуск не входят. Подключение стороннего сервиса не выполняется автоматически после создания бота.

## API для коннекторов

`POST /api`, `Content-Type: application/json`, `Authorization: Bearer <bot-token>`.

Следующие scoped extensions реализованы в исходниках, не означают развёртывание или включение инструментов на production. Выполнение core tools и изолированный privileged broker — отдельный контракт центрального plugin; перед каждым privileged call нужна свежая проверка trusted.

- `bot_get_me` → `{user,bot,installs,toolPolicy:{revision,owner,users}}`. Политика видна только worker, не публичному списку ботов. Публичный `bot.transportVersion:2` у modern bots — только capability scoped transport; legacy имеет 0, старый backend может не иметь поля. Это не признак включённых core tools/isolation runtime.
- `bot_authorize_update {update_id}` → `{update_id,bot_id,channel,chat,sender,access:{trusted,policy_revision},limits:{text:2000,attachment:10485760,parts:32}}`. Проверяет актуального активного человека, видимость/членство, установку и неизменный исходный текст/ID вложения; редактирование/удаление источника отменяет authority; после редактирования восстановление прежнего текста не возобновляет доступ (durable source cancellation). Поля requester/sender клиента не авторитетны.
- `bot_attachment_file {update_id}` → `{name,mime,data}` только для вложения доставленного invocation; произвольного чтения истории/файлов нет.
- `bot_edit {update_id,response_key,revision,text}`: только свой output этого update, caption/text; начальная revision 0, следующая old+1, равная с тем же текстом идемпотентна. `bot_delete {update_id,response_key}` — идемпотентный tombstone без восстановления replay.
- `bot_typing {update_id,typing?:boolean}` — volatile TTL 8 секунд; `state.botTyping:[{bot,channel,until}]` фильтруется актуальной видимостью и authority, очищается false/ack/revoke.
- `bot_get_updates {after?:number,limit?:1..50}` → `{updates,ack}`. Без `after` возвращает все ожидающие события до лимита; получение не подтверждает обработку.
- Событие: `{update_id,channel,message,sender:{id,name},chat:{id,kind,name},command?:{name,args}}`. `chat.kind` — `group` или `direct`. `channel` всегда фактический канал/личный диалог ответа; `chat.id` в группе — ID группы.
- `bot_reply {update_id,text,attachment?,response_key?}` → сохранённое сообщение. Ключ по умолчанию `main`, 1–64 ASCII alphanumeric/`_`/`-`, максимум 32 части. Текст 0–2000, пустой только с AttachmentDraft штатного human pipeline (10 МиБ, безопасные MIME/UUID); сумма вложений update ≤20 МиБ. Цель только из event. Точный replay возвращает прежний output, другой payload с тем же ключом — `BOT_RESPONSE_CONFLICT`; `BOT_OUTPUT_LIMIT` для превышения лимитов. Источник/authority проверяются при каждой операции. Manifest сохраняется до ответа, legacy `response` для main сохраняется.
- `bot_ack {update_id}` → `{ok,ack}`. Подтверждает обработку; `ack` движется через непрерывный обработанный префикс. Ответ и подтверждение — разные операции.

У modern bot `managementVersion:1` и публичный `conversation` (legacy 0; отсутствует на старом backend), без заявления о включённых runtime tools. `get_bot_settings {bot}` и `update_bot_settings {bot,revision,profile?,conversation?}` — только действующий human owner самого бота (не администратор/роль/trusted user), ответ `{bot,profile:{name,bio,avatar},revision,conversation}`. CAS начинается с 0; ошибки `BOT_SETTINGS_FORBIDDEN`, `BOT_SETTINGS_CONFLICT`, `BOT_SETTINGS_INVALID`. Профиль: name 1–32, bio ≤512, avatar PNG/JPEG/WebP data URI ≤256 КиБ decoded или пустая строка для удаления. Username/owner/token неизменяемы. `bot_get_settings {update_id}` / `bot_update_self {update_id,revision,profile?,conversation?}` требуют свежий источник именно владельца в реальной двухсторонней личке owner+bot; `chat.kind` не заменяет проверку состава диалога.

`bot_react {update_id,emoji,enabled?:true}` идемпотентно добавляет/снимает только реакцию bot UID на исходном доставленном сообщении. Emoji: 👍 ❤️ 😂 🔥 🎉 👀. Произвольные message/channel/user не дают другого назначения; актуальная source authority обязательна. Conversation: `{mode:'addressed'|'name_dialog',aliases:string[],followupSeconds:0..600,followupMessages:0..20,reactions:boolean}`; defaults addressed, aliases [], 180 секунд, 8 сообщений, reactions true. Aliases ≤20, каждый 1–64 Unicode символа, без управляющих символов/внешних пробелов, уникальны без учёта регистра. Opt-in name_dialog распознаёт имя/aliases на границах Unicode слов, затем только того же автора/канал до TTL/бюджета; 0 отключает followups. Приватные сессии (≤256/бот) не входят в DTO. ACK с сохранённым ответом однократно продлевает TTL, не бюджет. Отключение режима очищает сессии и отменяет ожидающие name/followup sources; прежние команды/mentions и legacy privacy сохраняются.

Offline maintenance: **остановить Sombra, сделать приватную резервную копию единственной базы**, затем `SOMBRA_OFFLINE_MAINTENANCE=1 MINES_DATA_DIR=... mines-server --configure-bot USERNAME JSON_FILE`. JSON содержит только `profile`/`conversation`, без revision/IDs/секретов. Выбирается ровно один существующий enabled modern bot по точному username, применяются owner/CAS/профильные валидаторы; сессии/учётные данные не создаются и не ротируются. Это не HTTP API и не межпроцессный lock; одновременно с сервисом запрещено.

`get_bot_tool_users {bot}` и `set_bot_tool_users {bot,users,revision}` → `{revision,owner,users}` требуют сессию активного human owner самого бота. CAS revision, уникальные ≤50 стабильных ID активных людей; usernames, роли и `bots.manage` не дают grant. Owner неявно trusted. Ошибки `BOT_POLICY_FORBIDDEN`, `BOT_POLICY_INVALID`, `BOT_POLICY_CONFLICT`. Удалённый/изменённый источник: `BOT_SOURCE_UNAVAILABLE`; отсутствующий/истёкший/повреждённый scoped файл: `BOT_ATTACHMENT_UNAVAILABLE`; повреждённый response manifest: `BOT_RESPONSE_UNAVAILABLE`. Для новых событий сохраняется digest вложения, включая обнаружение замены файла того же размера. Ack не требует живого источника, позволяя закрыть мёртвое событие без tools.

Управление требует человеческой сессии: `create_bot {group,name,username}`, `add_bot_to_group {bot,group}`, `remove_bot_from_group {bot,group}`, `bot_rotate_token {bot}`, `delete_bot {bot}`. Публичное состояние не содержит хешей/токенов.

Очередь и дедупликация хранятся в той же атомарно сохраняемой базе, с fsync файла и каталога на Linux. Лимит — 1000 неподтверждённых событий на бота; при переполнении новая адресованная отправка отклоняется, а старые события не теряются. Завершённые записи дедупликации пока сохраняются без автоматического удаления. Один активный worker на бота; многоконсьюмерная аренда пока не реализована.

## Hermes на действующем сервере

Сервис `sombra-hermes.service` запускает `sombra-hermes-worker.py`; бот хранит SQLite-очередь ответов и отдельные контексты в `/var/lib/sombra-hermes/`. Учётные данные Sombra — `/etc/sombra-hermes/bot.env` (root:hermes, 0640; каталог 0750). Провайдер использует **существующую установку Hermes** и её хранилище авторизации. Telegram-токен не копируется; работающий `roxy-hermes.service` не перенастраивается и не перезапускается.

Worker получает команду, вызывает `hermes-turn.py` через Python/dependency bootstrap, выбранный установленным Hermes, сохраняет ответ в SQLite **до** отправки, затем вызывает идемпотентный `bot_reply` и подтверждает событие. После сетевого сбоя/перезапуска готовый ответ повторно не генерируется. Конкурентный второй worker отвергается файловой блокировкой; база привязана к bot ID.

Это at-least-once обработка и дедупликация сохранённых ответов, **не гарантия exactly-once вызова модели**: сбой между ответом провайдера и сохранением SQLite может привести к повторному вызову. Ответы модели ограничены 2000 символами. В журнал пишутся только ID события/категория ошибки, не текст пользователя, не ответ и не секреты.

Групповые контексты разделены также по автору: один участник не получает контекст чужих обращений. Личка отделена от групп и других личек. Хранится до 12 последних текстовых сообщений на контекст; старые записи SQLite удаляются через 30 дней. `/reset` очищает только контекст автора в текущем чате.

Hermes запускается с `enabled_toolsets=[]`, `skip_memory`, `skip_context_files`, `skip_background_review`, без SOUL/персональной Telegram-истории. Пустой список инструментов и отсутствие внешней памяти проверяются перед каждым модельным вызовом; runtime с собственными инструментами `codex_app_server` запрещён. Пользовательский чат **не даёт** административных полномочий или доступа к серверным файлам. Нынешняя модель — `gpt-6-luna`, провайдер `openai-codex`; выбранная конфигурация хранится только в существующем Hermes.

Диагностика: `systemctl status sombra-hermes`; `journalctl -u sombra-hermes -n 50 --no-pager`. Если ключ заменён в клиенте, вручную обновите защищённый env-файл на машине worker и перезапустите сервис. Никакой ключ не должен попадать в Git или чат.

## Безопасное первичное создание на сервере

Остановите `sombra.service`, создайте приватную резервную копию данных и только затем выполните:

```sh
SOMBRA_OFFLINE_MAINTENANCE=1 MINES_DATA_DIR=/var/lib/sombra \
 mines-server --provision-group-bot 'Игровая' 'Hermes' 'hermes' /private/new-bot.env
```

Исполнять от пользователя, владеющего базой. Операция требует ровно одну группу с таким именем, использует её владельца и штатную серверную валидацию, не создаёт человеческой сессии. Новому файлу нужны права 0600; существующий файл отвергается до изменения базы. Повтор для уже существующего бота того же владельца устанавливает группу и заменяет ключ — не запускайте без намерения ротации. Переменная — подтверждение offline-режима, **не межпроцессная блокировка**: одновременно открывать JSON-базу из двух процессов нельзя.

## Совместимость старых подключений

Старые `create_bot {channel,name}`, `bot_poll`, `bot_message` и `bot-worker.mjs` сохранены только для legacy токенов. Они имеют прежний доступ к истории **одной комнаты**, явно обозначенный `legacy_room_history`; не получают автоматически новые группы/лички/новую очередь. Их ID становится bot-user ID для корректного авторства истории. Новый токен и новые возможности нужно создать отдельно; автоматического расширения доступа нет.

## На что опирались

- Telegram: privacy mode и команды с адресацией `/command@bot`, личные чаты и меню команд: https://core.telegram.org/bots/features#commands и https://core.telegram.org/bots/features#privacy-mode .
- Telegram Bot API: обновления, курсор и подтверждение обработки: https://core.telegram.org/bots/api#getupdates .
- Discord: отдельные installation/invocation contexts и серверные разрешения команд: https://docs.discord.com/developers/interactions/application-commands .

Sombra использует собственные API/коннектор. Это не Telegram/Discord-совместимый transport и не полная копия их Bot API.
