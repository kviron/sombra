# Звук при навигации и входящий звонок

## Постоянное воспроизведение

Первоначальная гипотеза о conditional mount не подтвердилась: baseline уже содержал безусловный playback. Поэтому extraction VoicePlayback не объявляется единственной доказанной причиной пользовательского one-way audio.

Закреплена граница воспроизведения по joined room/client, не выбранному Home/DM. Audio-only input зависит от фактического receiver audio track, а не нового video/stream wrapper; наблюдаются изменения треков. При ontrack прежний same-kind receiver удаляется из обёртки без остановки WebRTC-owned source; события закрытого/заменённого peer игнорируются. Cleanup gain150% останавливает только созданный output, не исходные треки.

Actual RTC regression: две LiveChat/useVoice страницы, настоящий изолированный backend/RTCPeerConnection и Chrome fake media devices. Home→DM→Friends→Room сохраняют playing audio element/srcObject/live track/room, inbound bytes растут на каждом шаге. Это не проверка физических динамиков и не baseline reproduction; также отдельный исправленный native cache poll stall мог задерживать voice lease/signaling.

## Входящая плашка

Старое отключение кнопок по `dialogBusy || groupVoiceBusy` делало входящий отказ зависимым от посторонней настройки микрофона. Теперь состояние операции относится к конкретному call/account. Плашка nonmodal, не крадёт фокус и не перекрывает клики интерфейса. Decline/Escape/X сразу закрывают её локально и отменяют pending join, затем отправляют scoped decline API. Даже hung RPC/503 не удерживают пользователя в окне; ошибка показывается отдельно, polling не открывает dismissed call повторно.

Ожидающее Accept тоже можно отменить: identity операции инвалидируется до leave, затем выполняется реальный decline. Поздний результат не переводит пользователя в ЛС и не возвращает звонок. Cancel/expiry/account change останавливают ringtone и инвалидируют join. Refresh вынесен из action lock; ошибки дают повторную попытку. Ответ явно переключает с другой voice room, отрицательный ответ её не покидает.

Join getUserMedia ограничен30с на устройство. Leave сразу снимает pending/busy ownership; поздние разрешения закрывают только свои треки, старые catch/finally не затрагивают новый join. Если server admission завершился после отмены, второй idempotent voice_leave удаляет только заброшенный room/client.

Проверено:14 synthetic-stream actualReact playback scenarios;8 real RTC navigation;9 actual useVoice deferred-permission scenarios (в timeout-тесте только30000мс timer ускорен до300мс);31 incoming actualhook/overlay scenarios с настоящим backend/тремя людьми и управляемой voice boundary, включая Escape/X/Decline при pending Accept. Всего62 проверки, без hardware-audio claim.

Изменения опубликованы в клиенте0.1.18. Backend API звонков не менялся.
