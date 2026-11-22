# Sombra

Приложение называется **Sombra (Сомбра)**. Корень проекта — этот каталог.

- Фронтенд: `src/` (React + TypeScript, Vite, алиас `@` → `src/`).
- Приложение Tauri: `src-tauri/` (Rust-оболочка, `tauri.conf.json`, иконки, capabilities).
- Серверный код: `crates/sombra-core/` (логика API) и `crates/sombra-server/` (бинарник `mines-server`).
- Документация: `docs/`.

Перед работой с бэкендом, подключением клиента или развёртыванием прочитай [docs/SOMBRA-SERVER.md](docs/SOMBRA-SERVER.md) — это запись о действующем сервере. [docs/DEPLOY.md](docs/DEPLOY.md) описывает общий шаблон установки, [docs/BACKEND.md](docs/BACKEND.md) — контракт API.

Правила, которые уже действуют в проекте:

- Версию меняют сразу в трёх местах: корневой `Cargo.toml` (`[workspace.package]`), `src-tauri/tauri.conf.json`, `package.json`.
- Клиент не должен знать секретов: ключи подписи и SSH-доступ лежат вне репозитория (`release-secrets/`, `.env`), оба пути в `.gitignore`.
- Схему базы и операции API меняют вместе с тестами (`cargo test`), фронтенд — вместе с `npx tsc --noEmit`.
- Линтер и форматтер: `npm run lint` (ESLint, должен проходить без ошибок; предупреждения — это долг, а не блокер), `npm run lint:fix`, `npm run format` / `npm run format:check` (Prettier). Полный прогон Prettier по репозиторию ещё не применялся: он почти удваивает объём файлов из-за плотного стиля, поэтому форматируют новые и изменённые файлы. Правила и стиль — в `eslint.config.js`, `.prettierrc.json`, `.editorconfig`.
- Данные только через сервисы: компоненты, страницы и хуки не вызывают `api` и `transport` напрямую. Новый запрос — метод в `shared/api/api.ts` и сервис в `entities/<сущность>/model/services` или `features/<фича>/model/services`; `shared/api/services` — только для того, что не принадлежит ни одной сущности. Типы ответов и DTO — в `shared/types/<тема>.ts`, константы — в `shared/const/`.
- Фронтенд разложен по Feature-Sliced Design: `app → pages → features → entities → shared`. Новый модуль кладут в срез своего слоя, импортируют только вниз и только через `index.ts` среза. Карта слоёв, правила и таблица «куда класть код» — в [docs/FRONTEND-STRUCTURE.md](docs/FRONTEND-STRUCTURE.md); границы проверяет `npm run check:fsd`, модульные тесты — `npm run test:src`.
- Сборка сервера и деплой описаны в `docs/DEPLOY.md`; изменения на живом сервере фиксируются в `docs/SOMBRA-SERVER.md`.
