# Картинки: быстрый возврат при прокрутке

Исправлены две независимые причины задержек.

## Native cache

Ранее state.decorate вызывал полное чтение каждого cached-вложения под общим cache lock: DPAPI, checksum, base64 и проверка payload повторялись при poll истории. Теперь cached — только проверенный по безопасному пути/типу/размеру метаданных availability-hint. Реальное чтение по-прежнему проверяет свежую разрешённую snapshot, account/server/generation, DPAPI, checksum и соответствие метаданных. Повреждённый payload не выдаётся и удаляется при чтении.

Измерение в Windows debug, не release-бенчмарк: старая decoration одного 10-МиБ файла 1,753с; новая metadata-decoration десяти файлов 3,952мс. Эквивалентная работа десяти полных проверок заняла17,58с, с обновлением синтетической авторизации между проверками (иначе старый путь пересекал5с freshness). Сама проверка файла при реальном чтении не ускорялась и остаётся под существующими locks.

RPC-тесты подтверждают: concurrent fresh cache hits не делают HTTP; concurrent stale hits делают ровно один state refresh. TTL/ACL/DPAPI не ослаблялись. Desktop95PASS,1 специально ignored timing-probe; явный probe пройден.

## UI preview

- IntersectionObserver использует фактическую scroll-область, включая voice-messages; preload-margin600px.
- Загрузившееся превью не уничтожается при выходе за экран. Невидимые удерживаются до60с, удаляются LRU при бюджете64МиБ/48entries; активные viewport/viewer leases защищены от eviction и могут временно превышать idle-бюджет.
- Один in-flight запрос на identity: session/access generation/cache-write epoch/message/attachment metadata. Viewer и материалы разделяют Blob URL; base64 RPC-ответы не сохраняются глобально.
- Очередь до3, приоритет viewer→реально видимые→preload. Дальние невидимые не загружаются. Unmount освобождает lease; auth/cache change отзывает URLs и отсекает поздние ответы.
- Успешные clear/set-limit native/browser wrappers обновляют epoch, очищают дедупликацию и рассылают attachmentcachechange. Browser in-flight keys тоже включают write epoch.

6 unit-тестов проверяют grace/лимиты/singleflight/URL cleanup/scope. 14 реальных React/CDP сценариев с24 изображениями в отдельной голосовой панели проверяют600px preload,10циклов туда-обратно без blinking/новых запросов, общий URL viewer/materials, concurrency3, реальные IndexedDB clear/limit wrappers и auth race. API/PNG boundary синтетическая; это не native GUI performance proof.

Клиентский фикс пока не опубликован. Production Python-плагин не связан с этим изменением; требуется следующий Windows-клиент.
