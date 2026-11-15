# Сервер Mines для настольных приложений

Приложения установлены на компьютерах пользователей. На сервер разворачивается только Rust-бэкенд: аккаунты, группы, каналы, сообщения и сигнализация голосовых звонков. Caddy обеспечивает HTTPS для API; веб-интерфейс не собирается и не раздаётся. Node.js и графическое окружение на сервере не нужны.

## Минимальный сервер без Docker (основной вариант)

На сервере работают один готовый файл `mines-server` под systemd и HTTPS-прокси. Если прокси уже установлен, используйте его: второй не нужен. Docker, Rust, Node.js, отдельная СУБД и сборка на сервере не требуются. Данные хранятся в `/var/lib/mines`. Число асинхронных рабочих потоков ограничено одним; фактическое потребление памяти зависит от истории сообщений и числа пользователей, фиксированный минимум RAM не гарантируется.

### Собрать на своём компьютере

Из папки `app`, с запущенным Docker Desktop в режиме Linux-контейнеров:

```sh
docker build --platform linux/amd64 --target server-export --output type=local,dest=server-release .
```

В `server-release` появятся Linux-файл `mines-server` и настройки `deploy`. Для ARM64-сервера замените платформу на `linux/arm64`. Файл собирается на Debian 12: используйте Debian 12/13 или совместимую систему с glibc не ниже 2.36, не Alpine. Windows-файл `.exe` на Linux не подходит. Сборка требует ресурсов только на компьютере; Docker на сервер переносить не нужно.

### Установить на сервер

Скопируйте содержимое `server-release` в отдельную папку сервера. Из неё выполните команды (Debian/Ubuntu с systemd; создание пользователя нужно только при первой установке):

```sh
sudo useradd --system --user-group --home-dir /var/lib/mines --shell /usr/sbin/nologin mines
sudo install -m 755 mines-server /usr/local/bin/mines-server
sudo install -d -m 755 /etc/mines
sudo install -m 600 deploy/mines.env /etc/mines/mines.env
sudo install -m 644 deploy/mines.service /etc/systemd/system/mines.service
sudo systemctl daemon-reload
sudo systemctl enable --now mines
curl http://127.0.0.1:3847/health
```

Ожидаемый ответ — `Mines ready`. systemd сам создаёт папку данных с доступом только для пользователя сервиса. Начальные данные для входа: `sudo cat /var/lib/mines/FIRST-USER.txt`; после входа смените пароль.

В существующем HTTPS-прокси направьте `/api` и `/health` на `127.0.0.1:3847`. Если используете Caddy, возьмите `deploy/Caddyfile.native`, замените `api.example.com` своим доменом и добавьте блок в `/etc/caddy/Caddyfile`, затем выполните `sudo systemctl reload caddy`. Caddy устанавливается отдельно. Направьте домен на сервер и откройте TCP 80/443. Порт 3847 оставьте локальным. Проверьте `curl https://ваш-домен/health`. `MINES_SECURE_COOKIE=1` требует HTTPS для входа пользователей.

Настройки TURN задаются в `/etc/mines/mines.env` через `MINES_ICE_SERVERS` (пример ниже), после изменения выполните `sudo systemctl restart mines`. Состояние: `systemctl status mines`; последние сообщения: `journalctl -u mines -n 100 --no-pager`.

Обновление: соберите новый файл на компьютере, перенесите на сервер, остановите `sudo systemctl stop mines`, сохраните приватную резервную копию всей `/var/lib/mines`, замените только `/usr/local/bin/mines-server` командой `sudo install -m 755 mines-server /usr/local/bin/mines-server`, затем `sudo systemctl start mines`. Не перезаписывайте настройки и данные. Для восстановления остановите сервис, верните копию в `/var/lib/mines`, восстановите владельца `mines:mines` и запустите сервис. Не запускайте два процесса с одной папкой данных.

## Docker Compose для локальной проверки или необязательного развёртывания

1. Направьте домен API на IP сервера, откройте TCP 80 и 443, установите Docker с Compose.
2. Скопируйте `Dockerfile`, `.dockerignore`, `compose.yaml`, `.env.example`, `Cargo.toml`, `Cargo.lock`, `build.rs`, папки `src` и `deploy` из `app` на сервер.
3. Выполните `cp .env.example .env`, замените `api.example.com` своим доменом.
4. Выполните `docker compose up -d --build`. Запускаются только `backend` и `gateway`. Caddy автоматически получает сертификат.
5. Проверьте `curl https://ваш-домен/health`: ответ `Mines ready`. Корень `/` возвращает 404 — сайта здесь нет.

База хранится в томе `mines-data`, сертификаты — в томах Caddy. Порт 3847 доступен только внутри Docker; наружу API выходит через HTTPS. Начальные данные владельца доступны администратору через `docker compose exec backend cat /data/FIRST-USER.txt`; после входа смените пароль. Новые аккаунты могут зарегистрироваться через API.

## Подключение установленного приложения

Все клиенты обращаются к одному адресу `https://ваш-домен/api`. Это JSON API: `POST` с `Content-Type: application/json`, тело `{ "op": "login", "email": "...", "password": "..." }`. Список операций — в [BACKEND.md](BACKEND.md).

Нативный HTTP-клиент приложения должен сохранять cookie `mines_session` из `Set-Cookie` после входа/регистрации и отправлять его в следующих запросах. Используйте cookie jar с проверкой домена и TLS, храните сессию приватно. Ответы имеют вид `{ "data": ... }` или `{ "error": "..." }`; HTTP 401 требует повторного входа. Токен в JSON-теле игнорируется. Bearer-заголовок предназначен для ботов, а не пользовательских сессий.

Для Tauri запросы к серверу выполняются из Rust-части приложения через IPC: прямой cross-origin fetch из WebView не поддерживается этим API. Cookie SameSite=Strict и защита от cross-site запросов сохранены. Передавайте понятный User-Agent для списка устройств.

Важно: демонстрационный клиент в этой папке пока использует встроенную локальную базу. Этот комплект меняет только серверное развёртывание; подключение вашего установленного клиента к указанному API необходимо настроить в его проекте. Локальные аккаунты и история автоматически на сервер не переносятся.

## Голос через интернет

Сервер обрабатывает `voice_join`, `voice_poll`, `voice_signal`, `voice_leave`; звук и видео идут между клиентами по WebRTC. Поддерживается до 8 участников в комнате. Записи голосовых сообщений пока нет.

Для связи через NAT нужен отдельно настроенный TURN-сервис. В `.env` укажите свои данные:

```dotenv
MINES_ICE_SERVERS='[{"urls":"stun:turn.example.com:3478"},{"urls":["turn:turn.example.com:3478?transport=udp","turns:turn.example.com:5349?transport=tcp"],"username":"your-user","credential":"your-credential"}]'
```

Выполните `docker compose up -d`. TURN в комплект не входит, его порты открываются отдельно. Учётные данные передаются участникам звонка: используйте ограниченные, регулярно обновляемые данные. Проверьте звук между двумя реальными устройствами в разных сетях.

## Проверки и обслуживание

`docker compose ps` и `docker compose logs --tail=100` показывают состояние сервисов. Проверьте вход двух пользователей, общую группу, обмен сообщениями и сохранение истории после перезапуска.

Один процесс backend обслуживает одну файловую базу; несколько писателей не поддерживаются. Перед обновлением остановите backend: `docker compose stop backend`, сохраните данные: `docker compose cp backend:/data ./backup-data`, затем `docker compose start backend`. Копия содержит приватные данные. Для восстановления остановите backend, верните файлы в `/data`, сохраните владельца UID/GID 10001 и запустите сервис.

Обновление: `docker compose up -d --build`. Не используйте `docker compose down -v`: эта команда удаляет данные. Если обновляетесь с предыдущего варианта, удалите старый сервис `web` командой `docker compose up -d --build --remove-orphans`.

Без Docker сервер собирается командой `cargo build --locked --release --no-default-features --bin mines-server`. Настройки: `MINES_DATA_DIR`, `MINES_BIND`, `MINES_SECURE_COOKIE=1` за HTTPS-прокси и `MINES_ICE_SERVERS`. Пример локальной проверки: `cargo build --locked --no-default-features --bin mines-server`, затем `node check-deploy.mjs`.

Фактическая конфигурация публичного сервера Sombra описана в [SOMBRA-SERVER.md](SOMBRA-SERVER.md).
