# Sombra

Настольный мессенджер с голосом, музыкой и настройками профиля. Клиент — Tauri v2 + React, сервер — Rust (axum) с файловой базой.

## Структура

```
├─ src/                      фронтенд (React + TypeScript, Vite)
├─ src-tauri/                приложение Tauri
│  ├─ src/                   Rust-оболочка: команды, трей, уведомления, обновления
│  ├─ capabilities/          разрешения Tauri
│  ├─ icons/                 иконки приложения и установщика
│  ├─ build.rs               tauri-build + подготовка Windows-сборки
│  └─ tauri.conf.json        окно, updater, бандл
├─ crates/
│  ├─ sombra-core/           логика API: операции, база, диагностика
│  └─ sombra-server/         бинарник mines-server (сервер и обслуживание базы)
├─ deploy/                   systemd, nginx/Caddy, публикация обновлений
├─ docs/                     описание API, сервера, выпусков и функций
├─ scripts/                  хелпер потока музыки и вспомогательные скрипты
├─ design/                   макеты интерфейса
├─ public/                   статические файлы
└─ index.html                точка входа Vite
```

`src-tauri` и оба крейта — участники одного Cargo workspace; версия задаётся в корневом `Cargo.toml` (`[workspace.package]`).

## Требования

- Node.js 20+ и npm
- Rust (stable) и Cargo
- Windows: WebView2 (есть в Windows 11), для установщика — NSIS (Tauri скачает сам)
- Linux (сервер): только Docker или Rust — клиент на Linux не собирается

## Разработка

```bash
npm ci

# API для разработки: Vite поднимает mines-server сам, но бинарник должен существовать
cargo build -p sombra-server

npm run dev          # только фронтенд на http://127.0.0.1:1420
npm run tauri:dev    # окно Tauri с фронтендом из Vite
```

`npm run dev` проксирует `/api` на `127.0.0.1:3847` и запускает `mines-server` при первом запросе (данные — в `./data`).

## Сборка и выпуск

```bash
npm run build                     # tsc + vite build → dist/
cargo build --release -p sombra-server   # сервер
npm run check:release             # версии, канал обновлений, публичный ключ, секреты
```

Выпуск делает CI: тег `vX.Y.Z` собирает подписанный NSIS, `latest.json` и публикует GitHub Release, откуда клиент и берёт обновления. Порядок и секреты — в [docs/UPDATES.md](docs/UPDATES.md). Локальный аварийный выпуск — `npm run release:windows`.

Сервер в Docker:

```bash
docker build --platform linux/amd64 --target server-export --output type=local,dest=server-release .
```

## Проверки

```bash
cargo test                        # тесты API и клиентской части
npm run test:updater              # состояние обновлений
npm run test:avatars              # кэш аватаров
npx tsc --noEmit                  # типы фронтенда
```

## Документация

- [docs/BACKEND.md](docs/BACKEND.md) — операции API и форматы данных
- [docs/SOMBRA-SERVER.md](docs/SOMBRA-SERVER.md) — рабочий сервер, что и где развёрнуто
- [docs/DEPLOY.md](docs/DEPLOY.md) — установка сервера
- [docs/UPDATES.md](docs/UPDATES.md) — подпись и канал обновлений
- [docs/FRONTEND.md](docs/FRONTEND.md) — структура фронтенда
- [AGENTS.md](AGENTS.md) — правила работы с репозиторием
