# Звук при навигации и входящий звонок

## Постоянное воспроизведение

Первоначальная гипотеза о conditional mount не подтвердилась: baseline уже содержал безусловный playback. Поэтому extraction VoicePlayback не объявляется единственной доказанной причиной пользовательского one-way audio.

Закреплена граница воспроизведения по joined room/client, не выбранному Home/DM. Audio-only input зависит от фактического receiver audio track, а не нового video/stream wrapper; наблюдаются изменения треков. При ontrack прежний same-kind receiver удаляется из обёртки без остановки WebRTC-owned source; события закрытого/заменённого peer игнорируются. Cleanup gain150% останавливает только созданный output, не исходные треки.

Actual RTC regression: две LiveChat/useVoice страницы, настоящий изолированный backend/RTCPeerConnection и Chrome fake media devices. Home→DM→Friends→Room сохраняют playing audio element/srcObject/live track/room, inbound bytes растут на каждом шаге. Это не проверка физических динамиков и не baseline reproduction; также отдельный исправленный native cache poll stall мог задерживать voice lease/signaling.

## Входящая плашка

Старое отключение кнопок по `dialogBusy || groupVoiceBusy` делало входящий отказ зависимым от посторонней настройки микрофона. Теперь состояние операции относится к конкретному call/account; Decline/Escape/X независимы от group voice busy и отменяют именно этот вызов через API, а не просто прячут плашку.

Ожидающее Accept тоже можно отменить: identity операции инвалидируется до leave, затем выполняется реальный decline. Поздний результат не переводит пользователя в ЛС и не возвращает звонок. Cancel/expiry/account change останавливают ringtone и инвалидируют join. Refresh вынесен из action lock; ошибки дают повторную попытку. Ответ явно переключает с другой voice room, отрицательный ответ её не покидает.

Join getUserMedia ограничен30с на устройство. Leave сразу снимает pending/busy ownership; поздние разрешения закрывают только свои треки, старые catch/finally не затрагивают новый join. Если server admission завершился после отмены, второй idempotent voice_leave удаляет только заброшенный room/client.

Проверено:14 synthetic-stream actualReact playback scenarios;8 real RTC navigation;9 actual useVoice deferred-permission scenarios (в timeout-тесте только30000мс timer ускорен до300мс);25 incoming actualhook/overlay scenarios с настоящим backend/тремя людьми и управляемой voice boundary, включая Escape/X/Decline при pending Accept. Всего56 проверок, без hardware-audio claim.

Изменения ещё не опубликованы в клиенте0.1.17. Backend API звонков не менялся.
