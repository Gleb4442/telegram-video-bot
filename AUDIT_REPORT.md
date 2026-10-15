# Аудит Telegram media downloader — исправления и production-проверка

**Проект:** `/Users/pro/telegram-video-bot` (Desktop symlink). **Период:** 14–15 октября 2026.
**Стек:** TypeScript/grammY, Vercel Node 24 + Python 3.12; direct Instagram/TikWM/Cobalt; новый optional serverless режим Inngest Free + Upstash Redis Free.
**Объём:** все входы, конфигурация, сообщения/captions/inline/settings/albums/errors, webhook/polling/scripts, resolver/provider контракты, кеши, зависимости, секреты, загрузка/отправка, бесплатный хостинг и concurrency.

**36 подтверждённых находок: 35 исправлены локально, 1 требует внешнего действия (C01).** Исправления approved пользователем. Код развёрнут в production 15 октября 2026: `1df3349`, [Vercel deployment](https://vercel.com/glebw2008-7382s-projects/telegram-video-bot/sApzHvg4hM1Lqyn1juVtkxCd3Pim). Извлечение + реальное скачивание Instagram MP4 проверены с Vercel; пользователь подтвердил получение самого видео в Telegram («Видео пришло»). Inngest/Upstash credentials не добавлялись; сейчас действует bounded synchronous mode, durable guarantees не активированы.

Главный результат: файлы загружаются multipart вместо URL; это поднимает путь отправки с 20 до 50 МБ. Ограничения 10 минут в коде нет. Для файла выше 50 МБ бот пробует меньший источник; если он недоступен или тоже велик, остаётся оригинальная ссылка. Бесплатный вариант не даёт нативную отправку произвольных файлов до 2 ГБ: Telegram разрешает её через отдельный Local Bot API server, который противоречит условию «без отдельного сервера».

Выбран бесплатный вариант: один Vercel Hobby + Inngest Free (очередь/retries, global 4/user 1) + Upstash Redis Free (settings/checkpoints/quota/file_id). Долгая операция выполняется отдельной serverless функцией 300 с, webhook подтверждается после принятия события. Не нужны несколько Telegram webhook или постоянно работающий процесс. Без 4 новых credentials остаётся synchronous50 с mode без durable гарантий — это явно описано в README.

## Подтверждённые находки и исправления

### [H06] Неверный webhook-адаптер — Critical

- **Где:** `api/webhook.ts`.
- **Причина / воспроизведение / влияние:** Vercel уже прочитал stream; http-адаптер ждал его повторно.
- **Исправление:** next-js использует parsed req.body; покрыты Node/Web вызовы.
- **Статус:** Исправлено локально; проверено.
- **Проверка:** `webhook-completion.test.ts`.

### [H01] Подтверждение незавершённой обработки — High

- **Где:** `api/webhook.ts`.
- **Причина / воспроизведение / влияние:** 9-секундный timeout возвращал успех до завершения скачивания.
- **Исправление:** В queued-режиме ACK только после приёма Inngest; в synchronous timeout отклоняет запрос.
- **Статус:** Исправлено локально; проверено.
- **Проверка:** `jobs-webhook.test.ts / webhook-completion.test.ts`.

### [H02] Ключ Cobalt отправлялся резервным сервисам — High

- **Где:** `src/services/resolvers/cobalt.ts`.
- **Причина / воспроизведение / влияние:** Любой configured fallback получал основной Authorization.
- **Исправление:** Ключ только точному primary endpoint; redirects запрещены.
- **Статус:** Исправлено локально; проверено.
- **Проверка:** `reliability.test.ts`.

### [H05] Потери файлов в альбомах — High

- **Где:** `src/bot.ts`.
- **Причина / воспроизведение / влияние:** slice(0,10), sendVideo для единственного фото; не было fallback для упавшего альбома.
- **Исправление:** Все порции, правильные типы и ссылки для неотправленной порции.
- **Статус:** Исправлено локально; проверено.
- **Проверка:** `audit-regressions.test.ts`.

### [S06] Удаление ожидающих обновлений при запуске — High

- **Где:** `scripts/dev-polling.ts`.
- **Причина / воспроизведение / влияние:** Polling/delete-webhook всегда использовали drop_pending_updates=true.
- **Исправление:** Сохранение по умолчанию, явный --drop-pending; предупреждение о смене webhook.
- **Статус:** Исправлено локально; проверено.
- **Проверка:** `Статическая проверка; destructive scripts не запускались`.

### [H03] Документы через неподдерживаемые URL — Medium

- **Где:** `src/services/delivery.ts`.
- **Причина / воспроизведение / влияние:** Telegram не гарантирует sendDocument MP4/JPG по URL; albums игнорировали режим.
- **Исправление:** Multipart InputFile для документов и альбомов; все ветви учитывают настройки.
- **Статус:** Исправлено локально; проверено.
- **Проверка:** `delivery.test.ts / download.test.ts`.

### [H04] Настройки терялись между процессами — Medium

- **Где:** `src/storage/state.ts`.
- **Причина / воспроизведение / влияние:** Обычная Map была единственным хранилищем.
- **Исправление:** Upstash Redis, атомарные toggles, stable bot-ID namespace; ограниченный временный fallback. Требует подключения Redis.
- **Статус:** Исправлено локально; проверено.
- **Проверка:** `state-integration.test.ts`.

### [M01] Таймаут не охватывал JSON body — Medium

- **Где:** `src/utils/http.ts`.
- **Причина / воспроизведение / влияние:** После headers зависшая body могла удерживать обработчик; caller abort игнорировался.
- **Исправление:** Отмена действует до конца чтения JSON и объединяется с caller signal.
- **Статус:** Исправлено локально; проверено.
- **Проверка:** `audit-regressions.test.ts`.

### [M02] Неполное видео local-processing — Medium

- **Где:** `src/services/resolvers/cobalt.ts`.
- **Причина / воспроизведение / влияние:** Первый tunnel возвращался как готовый файл без объединённого аудио.
- **Исправление:** localProcessing=disabled; unexpected response вызывает failover/явную ошибку.
- **Статус:** Исправлено локально; проверено.
- **Проверка:** `audit-regressions.test.ts`.

### [M03] Ссылки в captions и text_link игнорировались — Medium

- **Где:** `src/bot.ts`.
- **Причина / воспроизведение / влияние:** Пересланное медиа с hidden link не входило в message:text.
- **Исправление:** Оба message вида и entities/caption_entities.
- **Статус:** Исправлено локально; проверено.
- **Проверка:** `audit-regressions.test.ts`.

### [M04] Жёстко заданная идентичность бота — Medium

- **Где:** `src/bot.ts`.
- **Причина / воспроизведение / влияние:** BotInfo trsdownloadbot оставался при смене токена.
- **Исправление:** Получение настоящего getMe и кеш внутри bot instance.
- **Статус:** Исправлено локально; проверено.
- **Проверка:** `audit-regressions.test.ts`.

### [M05] Неверная классификация ошибок провайдера — Medium

- **Где:** `src/services/resolvers/cobalt.ts`.
- **Причина / воспроизведение / влияние:** 429/5 xx и не-JSON ответы давали неверные сообщения и мешали failover.
- **Исправление:** Раздельные RATE_LIMITED/SCRAPER_DOWN; fetch.empty классифицируется как сбой источника.
- **Статус:** Исправлено локально; проверено.
- **Проверка:** `audit-regressions.test.ts`.

### [S01] Поддельные поддерживаемые URL — Medium

- **Где:** `src/utils/urls.ts`.
- **Причина / воспроизведение / влияние:** Regex находил TikTok внутри query чужого хоста; pinterest.evil проходил проверку.
- **Исправление:** Разбор реального host/path, allowlist доменов, запрет userinfo/custom port.
- **Статус:** Исправлено локально; проверено.
- **Проверка:** `reliability.test.ts`.

### [S02] Небезопасные выходные медиа-адреса — Medium

- **Где:** `src/services/download.ts`.
- **Причина / воспроизведение / влияние:** Источник мог вернуть file:/private destinations. При новом downloader возникала бы SSRF.
- **Исправление:** Схема/URL, все IP DNS, pinning socket lookup, каждый redirect, размеры/время/тип. SSRF в старом коде не заявляется: он не скачивал файлы сам.
- **Статус:** Исправлено локально; проверено.
- **Проверка:** `reliability.test.ts / download.test.ts`.

### [S03] Неограниченная нагрузка и память настроек — Medium

- **Где:** `src/storage/state.ts`.
- **Причина / воспроизведение / влияние:** Не было общих квот/concurrency; Map не ограничивалась.
- **Исправление:** 10 запросов/user/min, 120/global/min; concurrency4 и user1 в Inngest; bounded memory fallback.
- **Статус:** Исправлено локально; проверено.
- **Проверка:** `state-integration.test.ts`.

### [S04] Повторы webhook доставляли дубликаты — Medium

- **Где:** `src/services/jobs.ts`.
- **Причина / воспроизведение / влияние:** update_id не сохранялся, частично отправленные albums повторялись.
- **Исправление:** Inngest event ID, Redis done и checkpoints на 7 дней. Узкое crash window send→checkpoint неустранимо транзакцией Telegram.
- **Статус:** Исправлено локально; проверено.
- **Проверка:** `jobs-webhook.test.ts / state-integration.test.ts`.

### [S05] Уязвимости инструментов сборки — Medium

- **Где:** `package.json`.
- **Причина / воспроизведение / влияние:** Исходный audit содержал 30 advisory/path records:2 critical,10 high,14 moderate,4 low. Не runtime RCE бота.
- **Исправление:** Обновлены инструменты; убран ненужный Vercel peer runtime, compatible overrides; audit всех и prod зависимостей 0.
- **Статус:** Исправлено локально; проверено.
- **Проверка:** `audit/dependencies-after.json / dependencies-prod-after.json`.

### [L01] Ошибки LRU и границы TTL — Low

- **Где:** `src/utils/cache.ts`.
- **Причина / воспроизведение / влияние:** Замена ключа при полной cache удаляла чужую запись; истечение использовало >.
- **Исправление:** Удаление заменяемого ключа до eviction, TTL>=, проверка empty-key.
- **Статус:** Исправлено локально; проверено.
- **Проверка:** `audit-regressions.test.ts`.

### [L02] Слишком длинный author caption — Low

- **Где:** `src/bot.ts`.
- **Причина / воспроизведение / влияние:** Скрейпер мог вернуть author, превышающий лимит Telegram caption.
- **Исправление:** Ограничение author/title и HTML escaping.
- **Статус:** Исправлено локально; проверено.
- **Проверка:** `audit-regressions.test.ts`.

### [L03] Недостоверные обещания интерфейса — Low

- **Где:** `README.md`.
- **Причина / воспроизведение / влияние:** Обещались гарантированные HD/MP3/скорость/readiness; скрывался лимит 3 links.
- **Исправление:** Точные ограничения, предупреждение 3 links, корректные кнопки и описание настроек.
- **Статус:** Исправлено локально; проверено.
- **Проверка:** `bot.test.ts / ручная проверка текстов`.

### [C01] Inline выключен в Telegram — Medium

- **Где:** `BotFather`.
- **Причина / воспроизведение / влияние:** getMe supports_inline_queries=false; код не может изменить эту настройку.
- **Исправление:** Внешнее действие: /setinline владельцем бота.
- **Статус:** Внешнее действие; не устранено.
- **Проверка:** `Read-only Telegram getMe`.

### [R01] Лимит 20 МБ вместо передачи больших файлов — High

- **Где:** `src/services/delivery.ts`.
- **Причина / воспроизведение / влияние:** sendVideo(url) упирался в лимит URL, в том числе для длинного ролика.
- **Исправление:** Multipart до 50 МБ, меньший источник при превышении, оригинальная ссылка сохранена; ограничения длительности не вводятся.
- **Статус:** Исправлено локально; проверено.
- **Проверка:** `delivery.test.ts / download.test.ts`.

### [R02] Медиа-операция ограничивалась 10 секундами — High

- **Где:** `src/bot.ts`.
- **Причина / воспроизведение / влияние:** Медленная загрузка большого файла не укладывалась в client timeout.
- **Исправление:** В queued режиме client270 с, total280 с, функция 300 с; независимые limits byte/body.
- **Статус:** Исправлено локально; проверено.
- **Проверка:** `delivery.test.ts / webhook-completion.test.ts`.

### [R03] Единственный источник TikTok — Medium

- **Где:** `src/services/resolvers/tiktok.ts`.
- **Причина / воспроизведение / влияние:** Падение TikWM полностью ломало TikTok.
- **Исправление:** Независимый Cobalt fallback; при отказе всех источников исходная ошибка сохраняется.
- **Статус:** Исправлено локально; проверено.
- **Проверка:** `resolvers.test.ts / audit-regressions.test.ts`.

### [R04] Одновременные запросы дублировали извлечение — Medium

- **Где:** `src/services/resolvers/index.ts`.
- **Причина / воспроизведение / влияние:** 25 одинаковых ссылок создавали 25 запросов к scraper.
- **Исправление:** Singleflight Promise: одна операция на URL и короткая cache.
- **Статус:** Исправлено локально; проверено.
- **Проверка:** `reliability.test.ts:25 concurrent calls`.

### [R05] Истекшие URL сохранялись 30 минут — Medium

- **Где:** `src/services/resolvers/index.ts`.
- **Причина / воспроизведение / влияние:** Временные tunnel URL могли закончиться до TTL бота.
- **Исправление:** TTL2 мин, inline cache0, canonical sharing URL; не обещается гарантированный lifetime внешнего URL.
- **Статус:** Исправлено локально; проверено.
- **Проверка:** `reliability.test.ts / статическая проверка`.

### [R06] Чужие настройки в группе — Medium

- **Где:** `src/bot.ts`.
- **Причина / воспроизведение / влияние:** Любой участник мог нажать settings кнопки другого пользователя.
- **Исправление:** Owner ID в callback, проверка sender; legacy кнопки только в private chat.
- **Статус:** Исправлено локально; проверено.
- **Проверка:** `Статическая проверка ветви; bot.test.ts`.

### [R07] Повтор callback переключал настройку обратно — Medium

- **Где:** `src/storage/state.ts`.
- **Причина / воспроизведение / влияние:** Retry между toggle и ответом снова делал инверсию.
- **Исправление:** Атомарный Lua toggle+snapshot по update_id, replay возвращает тот же результат.
- **Статус:** Исправлено локально; проверено.
- **Проверка:** `state-integration.test.ts`.

### [R08] Неограниченный JSON ответ — Medium

- **Где:** `src/utils/http.ts`.
- **Причина / воспроизведение / влияние:** Недоверенный scraper мог заполнить память большим JSON.
- **Исправление:** Ограничение 1MiB по headers и фактическим chunks, общий deadline.
- **Статус:** Исправлено локально; проверено.
- **Проверка:** `reliability.test.ts`.

### [R09] Устаревший Instagram extractor и потеря причины ограничения — High

- **Где:** `audit/instagram-live-probe.jsonl`.
- **Причина / воспроизведение / влияние:** На 2 публичных reels оба endpoints вернули 400 error.api.fetch.empty.
- **Причина:** Cobalt 11.7.1 (`a636575`) использует старую shortcode GraphQL query и embed. На публичном `DeXA5froeiC` оба instances возвращали `fetch.empty`; обычный Node fetch с новой query тоже получал HTML. Современная numeric-media-id query с browser-compatible TLS/HTTP2 возвращает progressive video streams. Отдельный `Dd-4gKENRms` имеет явный age gate (gating_type=3), подтверждённый браузером.
- **Исправление:** Прямой anonymous Instagram extractor с текущей query и curl-impersonate transport в приватной Python-функции того же Vercel проекта; Cobalt остаётся резервом. Проверка ID поста, безопасных URL, смешанных альбомов, отсутствующих video streams; age gate получает отдельное сообщение. Аккаунт Instagram и платные сервисы не подключались.
- **Статус:** Fixed / Verified локально реальным скачиванием `DeXA5froeiC` через код приложения: 10 404 586 байт, 106.14 секунды, H.264 + AAC. Production-проверка через закрытый endpoint: HTTP 200, 10 404 586 байт, MP4, 1408 мс. Второй ролик возвращает отдельный AGE_RESTRICTED за 770 мс. Анонимное скачивание age-gated ролика не заявляется исправленным: Instagram требует авторизацию.
- **Тесты:** `tests/instagram.test.ts`; `scripts/probe-instagram-direct.ts`; `audit/instagram-direct-live.jsonl`.

### [R10] Короткое окно ответа холодного scraper — Medium

- **Где:** `src/services/resolvers/cobalt.ts`.
- **Причина / воспроизведение / влияние:** 6 секунд могли обрывать ответ проснувшегося free instance.
- **Исправление:** Настраиваемый 15 с deadline и повтор временных ошибок в queued mode.
- **Статус:** Исправлено локально; проверено.
- **Проверка:** `reliability.test.ts / статическая проверка`.

### [R11] Рост временного диска на видеоальбомах — Medium

- **Где:** `src/bot.ts`.
- **Причина / воспроизведение / влияние:** Прямая замена URL на multipart для 10 видео могла удерживать 500 МБ в одной операции.
- **Исправление:** Видео/документы порциями 2, фото 10; общий worker concurrency 4; cleanup каждой порции.
- **Статус:** Исправлено локально; проверено.
- **Проверка:** `download.test.ts / audit-regressions.test.ts`.

### [R12] Повторные большие передачи — Medium

- **Где:** `src/services/delivery.ts`.
- **Причина / воспроизведение / влияние:** Повтор знакомого ролика снова скачивал и загружал весь файл.
- **Исправление:** Telegram file_id cache; invalid ID обновляется из свежего источника, тип файла разделён.
- **Статус:** Исправлено локально; проверено.
- **Проверка:** `delivery.test.ts`.

### [R13] Скомпилированные тесты запускались повторно — Low

- **Где:** `vitest.config.ts`.
- **Причина / воспроизведение / влияние:** Без include filter Vitest запускал tests и dist/tests; число тестов удваивалось.
- **Исправление:** Явное tests/**/*.test.ts; Redis suite отдельной командой.
- **Статус:** Исправлено локально; проверено.
- **Проверка:** `pnpm test / test:integration`.

### [R14] Повторы просроченных query — Low

- **Где:** `src/services/delivery.ts`.
- **Причина / воспроизведение / влияние:** Очередь могла повторять уже истёкший answerCallbackQuery/InlineQuery.
- **Исправление:** Только явная ошибка expiry завершается без retry; остальные ошибки сохраняются. Telegram429 raw responses преобразуются в GrammyError до retry.
- **Статус:** Исправлено локально; проверено.
- **Проверка:** `delivery.test.ts`.

### [R15] Токены в ошибках управляющих скриптов — Medium

- **Где:** `scripts/{dev-polling,set-webhook,delete-webhook}.ts`, `src/utils/errors.ts`.
- **Причина / влияние:** транспортные ошибки могут включать URL Bot API с токеном; скрипты выводили целый error object.
- **Исправление:** логируется только имя/числовой код ошибки. Тексты пользователя и credentials не выводятся.
- **Статус:** исправлено локально; проверено.
- **Проверка:** `reliability.test.ts`; реальные переключения webhook не выполнялись.

## Проверка и границы доказательств

- `pnpm typecheck`, `pnpm build`, `git diff --check` — успешны.
- Portable TypeScript suite: 125 тестов; Python suite: 5 тестов; Redis integration: 4 теста (проверена ранее). Отдельная integration suite использовала настоящий Redis 8.2.2 в одноразовом temporary окружении, REST adapter Upstash SDK и реальные Lua-команды; проверены persistence, concurrent toggles, quota replay и delivery checkpoints. Production Redis не затрагивался.
- Загружен синтетический 30 МБ stream на диск; проверены declared/chunked oversize, hung body cancellation, cleanup, HTML вместо media, private redirects и pinned DNS. Telegram API/источники в regression tests моделируются. Не было реальной отправки 30 МБ файла в Telegram.
- Оба пользовательских reels проверены на обоих configured Cobalt endpoints:4 ответа 400 `error.api.fetch.empty`. Public Instagram HTML/embed также не дали извлекаемого media URL. Повторное расследование 2026-10-15 выделило устаревший extractor и age gating; см. R09. Первый ролик теперь скачан реальным кодом приложения, второй корректно распознаётся как age restricted.
- Настоящий downloader также успешно получил публичный CC0 MP4 с MDN (1,128,375 байт), выполнил DNS/socket проверки и очистил файл; `audit/live-download.jsonl`.
- Dependency audit:0 известных vulnerabilities во всех и отдельно production зависимостях на момент проверки. Это не доказательство отсутствия неизвестных уязвимостей.
- История до baseline scan:включён `.env` ignore, credential candidates не обнаружены эвристическим scan. Секреты не выводились. Живой Telegram проверялся только read-only.
- Нет гарантии строго exactly-once:Telegram send и Redis checkpoint не являются общей транзакцией. При аварии в узком промежутке после send возможен дубль. Семидневная dedup retention конечна.
- Signed Inngest execution endpoint проверен на unsigned отказ 401. Cloud queue/event routing, Vercel cold starts и настоящий Telegram multipart roundtrip требуют проверки после подключения бесплатных аккаунтов и deployment.

Артефакты: `audit/extended-tests.txt`, `audit/state-integration.txt`, `audit/dependencies-after.json`, `audit/dependencies-prod-after.json`, `audit/instagram-live-probe.jsonl`. Первоначальный подробный отчёт и baseline failing regressions сохранены в `audit/initial-report.md` и `audit/baseline-regressions.txt`.

## Что требуется для ввода в работу

1. Inngest Free event/signing keys и Upstash Redis Free REST URL/token; подробные шаги в README. Не использовать paid upgrades для выбранного варианта.
2. Deployment на Node 24 с Fluid Compute, sync `/api/inngest`, проверка очереди и собственного тестового чата. Текущий production и Telegram webhook во время аудита не менялись.
3. Развернуть проверенный direct Instagram extractor. Для age-gated/private контента нужен отдельный согласованный доступ к Instagram-аккаунту; анонимный extractor его не обещает.
4. BotFather `/setinline`, если inline действительно нужен. Фото/альбомы inline направляют пользователя в бот; основной media-download flow поддерживает их напрямую.

## Ограничения бесплатного решения

[Inngest Free](https://www.inngest.com/pricing):50,000 executions/month,5 concurrent steps. Один run+step расходует более одного execution. [Upstash Redis Free](https://upstash.com/pricing/redis):250 МБ,500,000 commands/month. [Vercel Hobby](https://vercel.com/docs/plans/hobby) имеет конечные CPU/memory/network квоты. Очередь сглаживает нагрузку, но не создаёт бесконечный бесплатный throughput или SLA. Quota exhaustion и отказ всех scraper providers остаются внешними ограничениями.

Протоколы: [Telegram upload limits](https://core.telegram.org/bots/api#sending-files), [Vercel function duration](https://vercel.com/docs/functions/configuring-functions/duration), [Cobalt API](https://github.com/imputnet/cobalt/blob/main/docs/api.md). Цены/квоты проверены по первичным страницам; оценивается текущая публикация, а не вечное обещание.

## Appendix A — деревья пользовательских сценариев

- ✅ `/start` / `/help` → объяснение платформ/режимов → ссылка или settings; ✅ unknown command/private → /help.
- ✅ Ссылка → text/caption/hidden link → parsed host/path → supported provider; ✅ unsupported/private → понятное сообщение; ✅ больше 3 ссылок → обработать 3 и предупредить.
- ✅ Несколько одинаковых URL одновременно → shared lookup → короткий cache; ✅ expired cache → fresh resolution; ⚠️ scraper error → failover → bounded retry → сообщение, если все источники недоступны (R09).
- ✅ Single video → download stream → size/time/MIME/URL checks → multipart upload → file_id cache; ✅ большой файл → smaller rendition если есть → upload; ⚠️ всё ещё велик/недоступен → оригинальная ссылка. Нет duration cap.
- ✅ Single photo → sendPhoto; ✅ document preference → actual file upload; ✅ video unsupported format → document fallback при явном Telegram400.
- ✅ Album → photo 10/video-doc2 batches → правильные типы → tail1 отдельно; ✅ failed batch → ссылки только на эту порцию; ✅ musicURL → отдельная кнопка.
- ✅ Settings → owner-tagged keyboard → sender validation → atomic persistence → markup и callback answer; ✅ callback replay → тот же snapshot; ✅ expired callback answer → не повторять. ⚠️ без Redis настройки временные.
- ⚠️ Inline включается внешне(C01) → ссылка → video result/cache0; ✅ photo/album → открыть основной бот; ⚠️ expired inline query → завершить без повторов, URL и file limits остаются ограничением inline-протокола.
- ✅ Authenticated webhook → validate update → durable event accepted → ACK200; ✅ auth error401 / invalid update400 / queue failure503; ✅ signed processing function → per-user/global concurrency → checkpoints/done → retries без повторения подтверждённых порций. ⚠️ crash after send before checkpoint допускает дубль.
- ✅ Polling/delete-webhook → preserve pending default → явный drop opt-in; ⚠️ polling переключает тот же bot с webhook, это объяснено.
- ⚠️ Deployment →4 credentials/free accounts → Fluid300 s → Inngest sync → real own-chat validation; при недостающих обязательных queued credentials fail-fast, legacy bounded mode обозначен.

## Summary table

| ID | Severity | Status | Location |
|---|---|---|---|
| H06 | Critical | Local verified | `api/webhook.ts` |
| H01 | High | Local verified | `api/webhook.ts` |
| H02 | High | Local verified | `src/services/resolvers/cobalt.ts` |
| H05 | High | Local verified | `src/bot.ts` |
| S06 | High | Local verified | `scripts/dev-polling.ts` |
| H03 | Medium | Local verified | `src/services/delivery.ts` |
| H04 | Medium | Local verified | `src/storage/state.ts` |
| M01 | Medium | Local verified | `src/utils/http.ts` |
| M02 | Medium | Local verified | `src/services/resolvers/cobalt.ts` |
| M03 | Medium | Local verified | `src/bot.ts` |
| M04 | Medium | Local verified | `src/bot.ts` |
| M05 | Medium | Local verified | `src/services/resolvers/cobalt.ts` |
| S01 | Medium | Local verified | `src/utils/urls.ts` |
| S02 | Medium | Local verified | `src/services/download.ts` |
| S03 | Medium | Local verified | `src/storage/state.ts` |
| S04 | Medium | Local verified | `src/services/jobs.ts` |
| S05 | Medium | Local verified | `package.json` |
| L01 | Low | Local verified | `src/utils/cache.ts` |
| L02 | Low | Local verified | `src/bot.ts` |
| L03 | Low | Local verified | `README.md` |
| C01 | Medium | External | `BotFather` |
| R01 | High | Local verified | `src/services/delivery.ts` |
| R02 | High | Local verified | `src/bot.ts` |
| R03 | Medium | Local verified | `src/services/resolvers/tiktok.ts` |
| R04 | Medium | Local verified | `src/services/resolvers/index.ts` |
| R05 | Medium | Local verified | `src/services/resolvers/index.ts` |
| R06 | Medium | Local verified | `src/bot.ts` |
| R07 | Medium | Local verified | `src/storage/state.ts` |
| R08 | Medium | Local verified | `src/utils/http.ts` |
| R09 | High | Fixed / Verified locally | `audit/instagram-live-probe.jsonl` |
| R10 | Medium | Local verified | `src/services/resolvers/cobalt.ts` |
| R11 | Medium | Local verified | `src/bot.ts` |
| R12 | Medium | Local verified | `src/services/delivery.ts` |
| R13 | Low | Local verified | `vitest.config.ts` |
| R14 | Low | Local verified | `src/services/delivery.ts` |
| R15 | Medium | Local verified | `src/utils/errors.ts` |
