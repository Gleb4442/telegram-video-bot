# AUDIT REPORT — Telegram Video Bot

**Дата:** 14 октября 2026, Europe/Kyiv.  
**Проект:** `/Users/pro/telegram-video-bot` (ярлык `/Users/pro/Desktop/telegram-video-bot`).  
**Исходная ревизия:** `0f5d79e`, main; рабочая копия была чистой.  
**Стек:** TypeScript, grammY 1.46.0, Zod 3, Node 20+, pnpm, Vercel, TikWM/Cobalt; постоянного хранилища нет.  
**Охват:** все tracked исходники, тесты, scripts, конфигурация, README/public page, dependency lockfile, reachable Git history; read-only проверки Telegram и HTTP endpoint.  
**Всего:** 21 подтверждённая находка — 11 исправлены и проверены локально, 9 ожидают согласования, 1 требует настройки Telegram. Отдельно 2 продуктовых решения.

## Вывод

Исходная версия не соответствует заявлению production-ready. Главные проблемы — неверный Node webhook adapter, раннее подтверждение незаконченной обработки, неполная доставка медиа, условная передача приватного ключа Cobalt сторонним резервам. Локальная версия устраняет первые три причины; deployment не выполнялся. Без durable state, защиты от злоупотребления и согласованных security исправлений обещать надёжность под нагрузкой нельзя.

## Доказательства и границы проверки

- Исходные 44 теста проходили; итоговые 64 теста проходят, `pnpm typecheck`, `pnpm build`, `git diff --check` успешны.
- 19 новых проверок запускались также в отдельной временной копии исходного Git HEAD: 17 падали, 2 проходили. Позже добавлена 20-я проверка timeout rejection. Исходный checkout не откатывался.
- [Лог итоговой проверки](audit/verification.txt), [лог исходных регрессий](audit/baseline-regressions.txt), [dependency audit](audit/dependencies-before.json), [prod-only audit](audit/dependencies-prod.json).
- Read-only Telegram: токен действителен, bot username `trsdownloadbot`, pending updates 0, webhook настроен, allowed updates message/inline_query/callback_query; inline отключён. Webhook GET HTTP 200; оба настроенных Cobalt instance GET HTTP 200. Это liveness, не проверка реального скачивания.
- Действующие сообщения не отправлялись, webhook/polling/секреты не менялись, deploy не запускался. End-to-end получение файлов в Telegram, масштабирование и логи Vercel не проверены.
- `.env` ignored; tracked `.env` в reachable history не найден. [Эвристический скан истории](audit/secret-history-scan.json) не дал кандидатов Telegram token/заполненного Cobalt key; это не доказательство отсутствия всех видов секретов. Значения секретов не записывались в отчёт.
- Нет БД/SQL/миграций, shell execution из пользовательского ввода, контейнеров, внешних административных маршрутов или UI форм. Эти поверхности отсутствуют, а не отмечены «проверено безопасно».

## Архитектура и доверие

Входы: сообщения и entities/captions Telegram, callbacks, inline query, операторские env/CLI. Webhook header подтверждает источник HTTP update; пользователи Telegram остаются недоверенными. TikWM/Cobalt получают URL и возвращают сторонние metadata/media URL. Видео хранится у внешнего сервиса/Telegram; приложение хранит process-local cache 500 entries/30min и неограниченные preferences. Media отправляются Telegram по URL; информация попадает в подписи, кнопки и диагностические логи. Full error objects и исходные URLs в логах требуют отдельной политики хранения/редактирования при работе с приватным контентом; подтверждённая утечка действующего Telegram token не установлена.

## 🔴 CRITICAL

### H06 — Node webhook использовал адаптер сырого потока

- **Категория / место:** Runtime/Deployment; [api/webhook.ts:64](/Users/pro/telegram-video-bot/api/webhook.ts:64).
- **Причина:** Изначально использовался http adapter, который слушает data/end вместо чтения req.body. Vercel разбирает JSON до вызова обработчика.
- **Влияние:** Обновление в основной конфигурации Node может зависнуть на уже прочитанном потоке. GET health при этом отвечает успешно.
- **Воспроизведение:** Передать VercelRequest с готовым body без нового события data/end; старый путь не обрабатывает update.
- **Исправление / план:** Переключён на next-js adapter, читающий разобранное тело. Проверка секретного токена сохранена.
- **Статус:** Verified локально. **Регрессионная проверка:** tests/webhook-completion.test.ts, Node adapter.

## 🟠 HIGH

### H01 — Успешный ACK до окончания загрузки

- **Категория / место:** Delivery; [api/webhook.ts:65](/Users/pro/telegram-video-bot/api/webhook.ts:65).
- **Причина:** Раньше grammY возвращал успех через 9000ms с onTimeout=return; Cobalt failover может занимать 12s ещё до Telegram отправки.
- **Влияние:** Telegram считает запрос обработанным, а работа может прекратиться после завершения serverless invocation; несколько ссылок усиливают риск.
- **Воспроизведение:** Fake timers: обработка длится 10s; исходный Web adapter завершает запрос на 9s.
- **Исправление / план:** Ожидание до 55s с onTimeout=throw, лимит Node функции 60s, Telegram запросов 10s. При превышении бюджета запрос ошибочный и допускает повтор. Это исправляет ранний ACK, но не гарантирует отсутствие дубликатов (S04).
- **Статус:** Verified локально. **Регрессионная проверка:** tests/webhook-completion.test.ts: оба адаптера и ошибочный timeout.

### H02 — Ключ Cobalt передаётся сторонним fallback

- **Категория / место:** Credentials; [src/services/resolvers/cobalt.ts:86](/Users/pro/telegram-video-bot/src/services/resolvers/cobalt.ts:86).
- **Причина:** Один Authorization header строится для каждого instance, включая сторонний fallback по умолчанию.
- **Влияние:** При настройке приватного ключа он раскрывается оператору резервного сервиса. В текущем .env ключ отсутствует; факт утечки действующего ключа не установлен.
- **Воспроизведение:** Изолированный fetch mock: primary 503 → fallback; оба запроса содержат Authorization с искусственным audit ключом.
- **Исправление / план:** Отправлять основной ключ только primary origin; отдельные credentials для явно настроенных доверенных резервов; запрет downgrade/междоменной пересылки. Тесты маршрутизации ключей и failover.
- **Статус:** Approval pending. **Регрессионная проверка:** —.

### H05 — Неполные альбомы и неверная доставка одиночных фото

- **Категория / место:** UX/Media; [src/bot.ts:268](/Users/pro/telegram-video-bot/src/bot.ts:268).
- **Причина:** Альбом обрезался slice(0,10), одиночное фото теряло тип и отправлялось как видео; ошибка альбома попадала в общий catch без ссылок.
- **Влияние:** Пользователь получает неполный альбом, неверный тип файла или только ошибку.
- **Воспроизведение:** Альбом из 11/21 фото; picker с одним фото; отказ sendMediaGroup.
- **Исправление / план:** Все элементы отправляются группами до 10 и отдельным последним элементом; photo type сохраняется; ссылки предоставляются для неотправленной части.
- **Статус:** Verified локально. **Регрессионная проверка:** tests/audit-regressions.test.ts: single photo, album 11/21, failed album.

### S06 — Скрипты безусловно удаляют очередь обновлений

- **Категория / место:** Data loss/Operations; [scripts/dev-polling.ts:8](/Users/pro/telegram-video-bot/scripts/dev-polling.ts:8).
- **Причина:** Polling удаляет webhook и pending updates; delete-webhook также использует drop_pending_updates=true.
- **Влияние:** Сообщения пользователей исчезают без обработки, запуск dev вмешивается в production webhook при одном токене.
- **Воспроизведение:** Прочитать оба скрипта: удаление очереди выполняется без опции оператора. Живые скрипты не запускались.
- **Исправление / план:** Сохранять pending по умолчанию, отдельный явный --drop-pending, предупреждение при переключении действующего webhook. Регрессионный mock API test.
- **Статус:** Approval pending. **Регрессионная проверка:** —.

## 🟡 MEDIUM

### H03 — Документный режим не соответствует Telegram API

- **Категория / место:** API contract/UX; [src/bot.ts:316](/Users/pro/telegram-video-bot/src/bot.ts:316).
- **Причина:** MP4/JPG передаются в sendDocument как URL, хотя гарантированная поддержка этого метода по URL ограничена PDF/ZIP. Альбомы вообще игнорируют asDocument.
- **Влияние:** Выбранный режим не гарантирует документ и обычно приводит к ссылке; альбом приходит обычными фото/видео.
- **Воспроизведение:** Выбрать Документ и отправить video/photo/album. Ограничение подтверждено официальным Telegram API, полноценная живая отправка не выполнялась.
- **Исправление / план:** Для реальных документов нужен ограниченный streaming upload с проверкой URL, редиректов, размера и времени. Альтернатива — явно заменить режим на скачивание по ссылке. UI/README уже уточнены, сам upload требует согласования безопасности.
- **Статус:** Approval pending. **Регрессионная проверка:** —.

### H04 — Настройки теряются между экземплярами сервера

- **Категория / место:** State/UX; [src/bot.ts:12](/Users/pro/telegram-video-bot/src/bot.ts:12).
- **Причина:** Единственное хранилище настроек — process-local Map.
- **Влияние:** Cold start и другой экземпляр Vercel возвращают default настройки, включая подпись и формат.
- **Воспроизведение:** Настроить один процесс, запустить второй — карта пустая.
- **Исправление / план:** Долговечное хранилище по Telegram user ID с атомарным переключением; нужна схема/конфигурация. Пока интерфейс честно сообщает о временности настроек.
- **Статус:** Approval pending. **Регрессионная проверка:** —.

### M01 — Timeout не охватывал чтение JSON

- **Категория / место:** Network/Performance; [src/utils/http.ts:5](/Users/pro/telegram-video-bot/src/utils/http.ts:5).
- **Причина:** Старый timeout снимался сразу после fetch headers, а response.json выполнялся отдельно; options.signal перезаписывался.
- **Влияние:** Зависшее тело исчерпывает время функции; внешняя отмена не работает.
- **Воспроизведение:** Mock возвращает headers и бесконечный JSON promise; abort caller во время чтения.
- **Исправление / план:** Общий helper покрывает fetch и JSON read, совмещает caller abort, удаляет таймеры/обработчики. Сохраняется поддержка Node 20 без зависимости от AbortSignal.any.
- **Статус:** Verified локально. **Регрессионная проверка:** tests/audit-regressions.test.ts: stalled JSON, caller cancellation.

### M02 — Незавершённый Cobalt tunnel выдавался как видео

- **Категория / место:** Media integrity; [src/services/resolvers/cobalt.ts:151](/Users/pro/telegram-video-bot/src/services/resolvers/cobalt.ts:151).
- **Причина:** Первый tunnel local-processing принимался за готовый файл, хотя потоки требуют merge/remux и audio может быть объектом.
- **Влияние:** Пользователь может получить видео без звука/несовместимый файл или непонятную ошибку схемы.
- **Воспроизведение:** Ответ local-processing с video/audio tunnels и объектом audio.
- **Исправление / план:** Запрашивается localProcessing=disabled; неожиданный ответ направляется на fallback, либо даёт UNSUPPORTED. Локальный remux не добавлен.
- **Статус:** Verified локально. **Регрессионная проверка:** tests/audit-regressions.test.ts: local-processing rejection.

### M03 — Ссылки в подписях и скрытых entities игнорировались

- **Категория / место:** UX/Journey; [src/bot.ts:227](/Users/pro/telegram-video-bot/src/bot.ts:227).
- **Причина:** Обработчик слушал только message:text и анализировал только видимый текст.
- **Влияние:** Пересланное медиа с URL в подписи или текстом «Видео» со скрытой ссылкой не скачивается, несмотря на инструкцию пересылать ссылки.
- **Воспроизведение:** Caption с text_link entity на TikTok.
- **Исправление / план:** Добавлены message:caption и Telegram text_link из entities/caption_entities.
- **Статус:** Verified локально. **Регрессионная проверка:** tests/audit-regressions.test.ts: forwarded caption.

### M04 — Жёстко задана идентичность чужого бота

- **Категория / место:** Configuration; [src/bot.ts:72](/Users/pro/telegram-video-bot/src/bot.ts:72).
- **Причина:** BotInfo всегда содержал trsdownloadbot, независимо от TELEGRAM_BOT_TOKEN.
- **Влияние:** Команды /help@другой_бот игнорируются; botInfo ошибочно сообщал включённый inline режим.
- **Воспроизведение:** Использовать mock actual bot audit_bot и addressed command.
- **Исправление / план:** grammY запрашивает getMe и кеширует реальную идентичность; тестовая инъекция BotInfo сохранена. Добавлен один getMe round-trip при cold start.
- **Статус:** Verified локально. **Регрессионная проверка:** tests/audit-regressions.test.ts: actual bot identity.

### M05 — Ошибочная классификация HTTP rate limit/outage

- **Категория / место:** Error handling; [src/services/resolvers/cobalt.ts:139](/Users/pro/telegram-video-bot/src/services/resolvers/cobalt.ts:139).
- **Причина:** Cobalt мог трактовать 429/5xx с не-JSON как общую ошибку; TikWM 429 давал UNKNOWN.
- **Влияние:** Пользователь не получает правильную инструкцию о перегрузке; диагностика путает outage с ошибкой контента.
- **Воспроизведение:** 429/503 с JSON у TikWM и plain text у Cobalt.
- **Исправление / план:** Статусы 429/5xx дают RATE_LIMITED/SCRAPER_DOWN; Cobalt пробует резерв при наличии.
- **Статус:** Verified локально. **Регрессионная проверка:** tests/audit-regressions.test.ts: HTTP 429/503.

### S01 — Проверка платформы сопоставляет подстроку URL

- **Категория / место:** Input trust; [src/services/resolvers/index.ts:88](/Users/pro/telegram-video-bot/src/services/resolvers/index.ts:88).
- **Причина:** Регулярные выражения не закреплены на начале адреса; Pinterest допускает произвольный доменный суффикс.
- **Влияние:** В resolver уходит неподдерживаемый реальный host. Это не доказательство SSRF в этом приложении: оно POST-ит URL фиксированному scraper endpoint.
- **Воспроизведение:** https://evil.example/?next=https://vm.tiktok.com/test/ и https://pinterest.evil/pin/123/ принимаются extractor.
- **Исправление / план:** URL parser, точный allowlist host/subdomains/paths и запрет credentials в URL; проверять одинаково registry и extractor; adversarial regression tests.
- **Статус:** Approval pending. **Регрессионная проверка:** —.

### S02 — Медиа URL недостаточно проверяются

- **Категория / место:** Third-party trust; [src/services/resolvers/tiktok.ts:135](/Users/pro/telegram-video-bot/src/services/resolvers/tiktok.ts:135).
- **Причина:** TikWM поля просто строки, Cobalt z.string().url не ограничивает схемы HTTP(S); сторонние значения идут в Telegram и пользовательские кнопки.
- **Влияние:** Невалидные/небезопасные назначения и сломанные кнопки. Прямой server-side download пока не реализован, поэтому локальный SSRF не утверждается.
- **Воспроизведение:** Подставить в mock response не-HTTP URL или произвольную строку; проверка отсутствует/схема может принять её.
- **Исправление / план:** Центральная проверка HTTP(S) media URL, валидация всех полей/альбомов; перед будущим upload дополнительно защита private IP/DNS/redirect.
- **Статус:** Approval pending. **Регрессионная проверка:** —.

### S03 — Нет ограничения затрат на пользователя

- **Категория / место:** Abuse/Performance; [src/bot.ts:12](/Users/pro/telegram-video-bot/src/bot.ts:12).
- **Причина:** Webhook secret защищает источник HTTP запросов, но легитимные Telegram пользователи не ограничены в частоте/concurrency; preference Map растёт без лимита.
- **Влияние:** Повторные ссылки запускают много scraper запросов и потребляют бюджет; долгоживущий polling может накапливать Map.
- **Воспроизведение:** Быстрые сообщения от многих пользователей; каждый проходит resolve; каждый новый settings toggle добавляет запись.
- **Исправление / план:** Durable per-user/global quota и concurrency, bounded preference cache, ответ о повторной попытке. Выбрать инфраструктуру и политику лимитов.
- **Статус:** Approval pending. **Регрессионная проверка:** —.

### S04 — Нет idempotency для повторных webhook updates

- **Категория / место:** Delivery/Integrity; [api/webhook.ts:70](/Users/pro/telegram-video-bot/api/webhook.ts:70).
- **Причина:** update_id нигде не хранится; при Telegram retry сообщение обрабатывается повторно.
- **Влияние:** Дубли загрузок и ответов, в том числе после timeout. Нельзя обещать exactly-once.
- **Воспроизведение:** Повторно передать один update_id в handler — middleware выполняется снова.
- **Исправление / план:** Долговечный atomic claim по update_id, lease/recovery и статус по этапам доставки. Простая локальная Map не решит несколько экземпляров; нужна схема и стратегия восстановления.
- **Статус:** Approval pending. **Регрессионная проверка:** —.

### S05 — Известные advisories в инструментальной цепочке

- **Категория / место:** Dependencies; [package.json:20](/Users/pro/telegram-video-bot/package.json:20).
- **Причина:** pnpm audit даёт 30 records: 2 critical, 10 high, 14 moderate, 4 low. Все пути проходят dev dependencies @vercel/node или Vitest; prod-only audit — 0.
- **Влияние:** Риск developer/CI/build контекста. Наличие advisory не означает доказанную эксплуатацию или runtime RCE; tinypool critical требует дополнительного prototype-pollution условия.
- **Воспроизведение:** См. audit/dependencies-before.json и dependencies-prod.json; lockfile воспроизводит версии.
- **Исправление / план:** Обновить @vercel/node/Vitest и транзитивные зависимости до исправленных совместимых версий, проверить engines и повторить typecheck/test/build/audit. Не применять слепой force.
- **Статус:** Approval pending. **Регрессионная проверка:** —.

### C01 — Inline mode отключён в живом Telegram боте

- **Категория / место:** External configuration; [src/bot.ts:187](/Users/pro/telegram-video-bot/src/bot.ts:187).
- **Причина:** Read-only getMe возвращает supports_inline_queries=false, хотя handler существует и allowed_updates содержит inline_query.
- **Влияние:** Пользователь не может вызвать inline функцию через @trsdownloadbot.
- **Воспроизведение:** getMe, 2026-10-14: supports_inline_queries=false.
- **Исправление / план:** Включить /setinline в BotFather владельцем бота, затем проверить результат в Telegram. Кодовые изменения не заменяют настройку Telegram.
- **Статус:** External action required. **Регрессионная проверка:** —.

## 🔵 LOW

### L01 — LRU терял чужую запись при обновлении

- **Категория / место:** Cache; [src/utils/cache.ts:26](/Users/pro/telegram-video-bot/src/utils/cache.ts:26).
- **Причина:** set существующего ключа на полной карте сначала вытеснял unrelated oldest; TTL сравнивался > вместо >=.
- **Влияние:** Лишние запросы к scraper, запись доступна на точной границе expiry.
- **Воспроизведение:** Заполнить a/b, обновить b и запросить a; прочитать ключ в expiresAt.
- **Исправление / план:** Сначала удаляется заменяемый ключ; expiry проверяется >=; пустой oldest key тоже допускается.
- **Статус:** Verified локально. **Регрессионная проверка:** tests/audit-regressions.test.ts: LRU replacement, TTL boundary.

### L02 — Неограниченный автор ломал caption

- **Категория / место:** Validation/UX; [src/bot.ts:60](/Users/pro/telegram-video-bot/src/bot.ts:60).
- **Причина:** Title ограничен 200 символами, author — нет.
- **Влияние:** Слишком длинный caption вызывает отказ media send, возможен отказ fallback message.
- **Воспроизведение:** Mock author из 5000 символов.
- **Исправление / план:** Author ограничен 200 символами с HTML escaping; результирующая подпись укладывается в media caption limit.
- **Статус:** Verified локально. **Регрессионная проверка:** tests/audit-regressions.test.ts: enormous author.

### L03 — Документация и UI обещали неподтверждённое

- **Категория / место:** UX/Documentation; [README.md:5](/Users/pro/telegram-video-bot/README.md:5).
- **Причина:** Устаревший Cobalt default, обещания latency<1.5s, universal HD/MP3, «production ready», статичный Webhook Active; молчаливый лимит трёх ссылок.
- **Влияние:** Пользователь не понимает доступность/качество/ошибки, оператор неверно оценивает состояние сервиса.
- **Воспроизведение:** Сравнить исходные README/public/UI с текущими config/handler и контрактами API.
- **Исправление / план:** README переписан по реальному поведению, уточнены settings/fallback/quality, названия кнопок, статичная страница и лимит трёх ссылок.
- **Статус:** Verified локально. **Регрессионная проверка:** Ручное сопоставление UI/config/README; исходные command tests проходят.

## 🤔 NEEDS PRODUCT JUDGMENT

- **PJ01 — Что возвращать inline для фото и альбомов?** Сейчас builder всегда videoMp4, first URL, empty results при ошибке. Обработчик есть, inline пока выключен; пользовательское обещание поддержки фото через inline отсутствует. Нужен выбор владельца: только видео с явной подсказкой или отдельные photo/article results и переход к альбому.
- **PJ02 — Как долго должны работать ссылки и повторное скачивание?** Resolver URLs кешируются 30min, inline results 300s; срок жизни конкретного tunnel не установлен. Нужен выбор: временная выдача с явным сроком либо повторное resolution/Telegram file_id для стабильной доставки. Не утверждаем как установленный баг всех URL.

## План согласования

Правило применённого [audit/SKILL.md](/Users/pro/.codex/skills/audit/SKILL.md), Phase 8.2: **“for anything security-critical, destructive (data deletion, schema migration), or touching authentication/authorization directly: present the plan and stop for explicit approval before touching code.”** Поэтому остановлены изменения credentials/URL trust/abuse/dependency security и схемы durable state, а также операторское поведение удаления очереди.

1. **Credentials/URL trust (H02, S01, S02):** central HTTP(S) parser + платформенный allowlist; Cobalt ключ только primary; отдельная конфигурация доверенных резервов, запрет credential forwarding redirect. Область: config/resolvers/HTTP. Проверки: malicious host, nested URL, non-HTTP URL, primary/fallback/redirect credential separation.
2. **Durable state и limits (H04, S03, S04):** выбрать доступный shared store; preferences, atomic update claims/leases и quotas. Нужны конфигурация/схема и retention. Область: bot/webhook/storage. Проверки: две независимые process instances, concurrent retry, stale lease, expired update, flooding. Не создавать фиктивную защиту локальной Map.
3. **Document upload (H03):** после URL validation добавить bounded streaming в Telegram без полного буферирования, с максимальными bytes/time, redirect/DNS/private-IP controls. Проверки: MP4/photo/album document, oversize, timeout, redirect; альтернативу режима ссылок согласовать явно.
4. **Toolchain (S05):** обновить поддерживаемые версии в package/lockfile, затем test/typecheck/build/full/prod audit. Учитывать engines и SDK типы; слепые overrides/force не применять.
5. **Operations (S06):** сохранить очередь по умолчанию, явная опция её сброса и ясное переключение webhook/polling; unit mocks подтверждают, что default не удаляет данные.
6. **Telegram (C01):** владелец включает inline через BotFather; отдельная живая проверка после настройки. Deploy локальных исправлений — отдельный следующий шаг, пока не выполнен.

## Appendix A — деревья пользовательских решений

Отмечено итоговое локальное состояние. ✅ обработано; ⚠️ работает с ограничением; ❌ подтверждённая проблема; 🤔 требуется продуктовый выбор.

### 1. Знакомство и помощь

- ✅ `/start` или `/help` → перечень платформ → отправить ссылку / открыть `/settings`.
- ✅ Качество источника и наличие audio описаны условно.
- ⚠️ Неизвестная команда → молча игнорируется; отдельного обещания помощи для произвольной команды нет.

### 2. Настройки

- ✅ `/settings` → кнопки caption/document → toggle → обновлённая клавиатура/answerCallbackQuery.
- ⚠️ Caption/format применяются к следующему single media в том же process.
- ❌ Другой экземпляр/cold start → defaults (H04).
- ❌ Document + video/photo → unsupported URL contract, может быть download fallback (H03).
- ❌ Document + album → photo/video group, preference игнорируется (H03).
- ⚠️ Telegram edit markup failure → catch без сообщения о рассинхронизации; локальная настройка уже переключена. Постоянные settings/atomic changes должны решить это в H04; подтверждённый failure был смоделирован чтением пути, live callback error не вызывался.

### 3. Обычное сообщение/пересылка

- ✅ Text / caption / hidden text_link → supported URL extraction.
- ✅ Нет URL в private → подсказка; нет URL в group → молчание.
- ✅ Повтор URL внутри одного сообщения → дедупликация.
- ✅ Больше трёх URL → явно предложено отправить остальные отдельно.
- ❌ URL с чужим host и встроенной supported ссылкой → false positive (S01).
- ✅ URL → cache hit / выбрать resolver → metadata/media.
- ✅ TikWM relative paths / HD preference / audio if present / slideshow.
- ✅ Cobalt primary → timeout/outage/restriction → fallback; окончательная ошибка → сообщение retry/unsupported/private/not found.
- ✅ Неожиданный local-processing → fallback или явный unsupported.
- ❌ Cobalt credential при fallback → пересылка стороннему сервису (H02).

### 4. Single media

- ✅ Video mode → sendVideo; single photo → sendPhoto.
- ✅ Clean mode → без подписи; caption mode → escaped ограниченная подпись.
- ⚠️ Document mode → попытка sendDocument → fallback link при отказе (H03).
- ✅ Telegram send failure → direct download button и честное сообщение о возможных причинах.
- ⚠️ Недоступна и отправка fallback/error reply → ошибка update; нужен повтор (S04).

### 5. Альбом

- ✅ 2–10 items → media group.
- ✅ >10 → следующие группы; одиночный хвост → sendPhoto/sendVideo.
- ✅ Сбой группы → отдельные download links этой части, без обрезания всего альбома.
- ✅ Audio metadata → дополнительная audio download button.
- ❌ Document preference → ignored (H03).
- ⚠️ Ошибка audio-message после успешного album → общий error reply, уже отправленные медиа остаются; повтор whole update может дублировать альбом (S04).

### 6. Inline query

- ❌ В production mode отключён в Telegram (C01).
- ✅ Handler: нет URL → empty result; URL → resolver → video result; failure → empty result.
- 🤔 Single photo / carousel → video builder не подходит; продуктовый выбор PJ01.
- 🤔 Expired tunnel / cached inline result → PJ02.

### 7. Webhook

- ✅ GET → liveness, не проверка media resolution.
- ✅ Не POST/GET → 405.
- ✅ Missing/invalid secret → 401; оба calling conventions тестируются.
- ✅ Authorized parsed Node body / Web JSON → update handler.
- ✅ Медленная обработка >9s → ожидание; timeout 55s → ошибка вместо успеха.
- ❌ Повторный update_id → обработка снова (S04).
- ⚠️ Невалидный JSON/config/network error → ошибка invocation; schema validation всего update не добавлялась.

### 8. Операторские сценарии

- ✅ set-webhook: URL missing/invalid → сообщение; Telegram failure → nonzero exit; success → getWebhookInfo.
- ⚠️ Non-HTTPS URL → warning и запрос к Telegram, который должен отклонить его; не отдельная подтверждённая потеря данных.
- ❌ dev/delete-webhook → удаление pending без opt-in (S06).
- ✅ SIGINT/SIGTERM polling → bot.stop.
- ⚠️ Static landing page больше не выдаёт неподтверждённый live status.

## Сводная таблица

| ID | Приоритет | Категория | Находка | Место | Статус |
|---|---|---|---|---|---|
| H06 | CRITICAL | Runtime/Deployment | Node webhook использовал адаптер сырого потока | [api/webhook.ts:64](/Users/pro/telegram-video-bot/api/webhook.ts:64) | Verified локально |
| H01 | HIGH | Delivery | Успешный ACK до окончания загрузки | [api/webhook.ts:65](/Users/pro/telegram-video-bot/api/webhook.ts:65) | Verified локально |
| H02 | HIGH | Credentials | Ключ Cobalt передаётся сторонним fallback | [src/services/resolvers/cobalt.ts:86](/Users/pro/telegram-video-bot/src/services/resolvers/cobalt.ts:86) | Approval pending |
| H05 | HIGH | UX/Media | Неполные альбомы и неверная доставка одиночных фото | [src/bot.ts:268](/Users/pro/telegram-video-bot/src/bot.ts:268) | Verified локально |
| S06 | HIGH | Data loss/Operations | Скрипты безусловно удаляют очередь обновлений | [scripts/dev-polling.ts:8](/Users/pro/telegram-video-bot/scripts/dev-polling.ts:8) | Approval pending |
| H03 | MEDIUM | API contract/UX | Документный режим не соответствует Telegram API | [src/bot.ts:316](/Users/pro/telegram-video-bot/src/bot.ts:316) | Approval pending |
| H04 | MEDIUM | State/UX | Настройки теряются между экземплярами сервера | [src/bot.ts:12](/Users/pro/telegram-video-bot/src/bot.ts:12) | Approval pending |
| M01 | MEDIUM | Network/Performance | Timeout не охватывал чтение JSON | [src/utils/http.ts:5](/Users/pro/telegram-video-bot/src/utils/http.ts:5) | Verified локально |
| M02 | MEDIUM | Media integrity | Незавершённый Cobalt tunnel выдавался как видео | [src/services/resolvers/cobalt.ts:151](/Users/pro/telegram-video-bot/src/services/resolvers/cobalt.ts:151) | Verified локально |
| M03 | MEDIUM | UX/Journey | Ссылки в подписях и скрытых entities игнорировались | [src/bot.ts:227](/Users/pro/telegram-video-bot/src/bot.ts:227) | Verified локально |
| M04 | MEDIUM | Configuration | Жёстко задана идентичность чужого бота | [src/bot.ts:72](/Users/pro/telegram-video-bot/src/bot.ts:72) | Verified локально |
| M05 | MEDIUM | Error handling | Ошибочная классификация HTTP rate limit/outage | [src/services/resolvers/cobalt.ts:139](/Users/pro/telegram-video-bot/src/services/resolvers/cobalt.ts:139) | Verified локально |
| S01 | MEDIUM | Input trust | Проверка платформы сопоставляет подстроку URL | [src/services/resolvers/index.ts:88](/Users/pro/telegram-video-bot/src/services/resolvers/index.ts:88) | Approval pending |
| S02 | MEDIUM | Third-party trust | Медиа URL недостаточно проверяются | [src/services/resolvers/tiktok.ts:135](/Users/pro/telegram-video-bot/src/services/resolvers/tiktok.ts:135) | Approval pending |
| S03 | MEDIUM | Abuse/Performance | Нет ограничения затрат на пользователя | [src/bot.ts:12](/Users/pro/telegram-video-bot/src/bot.ts:12) | Approval pending |
| S04 | MEDIUM | Delivery/Integrity | Нет idempotency для повторных webhook updates | [api/webhook.ts:70](/Users/pro/telegram-video-bot/api/webhook.ts:70) | Approval pending |
| S05 | MEDIUM | Dependencies | Известные advisories в инструментальной цепочке | [package.json:20](/Users/pro/telegram-video-bot/package.json:20) | Approval pending |
| C01 | MEDIUM | External configuration | Inline mode отключён в живом Telegram боте | [src/bot.ts:187](/Users/pro/telegram-video-bot/src/bot.ts:187) | External action required |
| L01 | LOW | Cache | LRU терял чужую запись при обновлении | [src/utils/cache.ts:26](/Users/pro/telegram-video-bot/src/utils/cache.ts:26) | Verified локально |
| L02 | LOW | Validation/UX | Неограниченный автор ломал caption | [src/bot.ts:60](/Users/pro/telegram-video-bot/src/bot.ts:60) | Verified локально |
| L03 | LOW | UX/Documentation | Документация и UI обещали неподтверждённое | [README.md:5](/Users/pro/telegram-video-bot/README.md:5) | Verified локально |
