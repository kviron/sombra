# Сервер Sombra

Развёрнут и проверен 15 ноября 2026 года.

- API: `POST https://sombra.mi-nerva.ru/api`. Принимает JSON с полем `op`. Вход устанавливает cookie `mines_session` с флагами `Secure`, `HttpOnly` и `SameSite=Strict`. Клиент должен сохранять и отправлять эту cookie в следующих запросах.
- Проверка: `curl -fsS https://sombra.mi-nerva.ru/health`. Текущий ответ — `Mines ready`. В исходниках ещё используются технические имена `mines-server` и `MINES_*`.
- systemd: `sombra.service`, включён в автозагрузку. Бинарник — `/usr/local/bin/sombra-server`, настройки — `/etc/sombra/sombra.env`. Статус: `systemctl status sombra`. Журнал: `journalctl -u sombra -n 100 --no-pager`.
- Nginx: `/etc/nginx/sites-available/sombra.mi-nerva.ru`. Проксирует `/api` и `/health` на `127.0.0.1:3847`. Корень `/` возвращает 404. Сертификат Let's Encrypt обслуживает существующий `acme.sh` с перезагрузкой Nginx при обновлении.
- Данные: `/var/lib/sombra`. Начальные данные владельца хранятся на сервере в `/var/lib/sombra/FIRST-USER.txt`. После первого входа нужно сменить пароль. SSH-доступ хранится в корневом `.env`. Используй его локально для подключения и не копируй секреты в репозиторий или клиент.

При развёртывании проверены публичный HTTPS, ответ 401 для запроса без сессии, вход, авторизованный запрос `me` и выход.

## Обновление

Из `app/` собери Linux-бинарник командой:

```sh
docker build --platform linux/amd64 --target server-export --output type=local,dest=server-release .
```

На сервере останови `sombra.service`, сделай приватную резервную копию всей `/var/lib/sombra`, установи собранный `server-release/mines-server` в `/usr/local/bin/sombra-server` с правами `755`, запусти сервис и проверь `/health`. Сохраняй действующие настройки в `/etc/sombra/`. С файловой базой одновременно должен работать только один процесс.

## Подключение клиента

Настольный клиент подключается к рабочему API через нативный HTTP-клиент Tauri с сохранением cookie. Контракт операций описан в [BACKEND.md](BACKEND.md). Локальные аккаунты и история автоматически на сервер не переносятся. TURN для голосовых звонков через интернет ещё не настроен.

## Клиент 0.1.0
Сессия настольного клиента сохраняется в хранилище Windows DPAPI. Рабочий API поддерживает прямое добавление участников группы по email. Перед обновлением сервиса сохранена приватная резервная копия бинарника и данных в `/root/sombra-backups/`. Сведения о выпуске приведены в [RELEASE-STATUS.md](RELEASE-STATUS.md).
